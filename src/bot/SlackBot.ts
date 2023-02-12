import {Logger, ModalView, SlashCommand, ViewOutput,} from "@slack/bolt";
import {
    ChatPostMessageArguments,
    ChatScheduleMessageArguments,
    ChatUpdateArguments,
    ViewsOpenArguments,
    WebClient
} from "@slack/web-api";
import {BotViewBuilder, ParkingLotDisplayItem} from "./BotViewBuilder";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {adjustDateAndTimeForTimezone, formatDateToPrintable, getTimezoneOffset} from "../utils/datefunctions";
import {ChangeMessageCommand} from "./Commands";
import {StandupViewData} from "../dto/StandupViewData";
import {UserInfo} from "../dto/UserInfo";
import {ACTION_NAMES} from "./ViewConstants";
import {PrivateMetadata} from "../dto/PrivateMetadata";
import {logger} from "../utils/context";
import {StandupStatusDao} from "../data/StandupStatusDao";
import {StandupStatus, StandupStatusType} from "../data/StandupStatus";
import moment, {tz} from "moment-timezone";

export type StandupDialogMessageType = "scheduled" | "post" | "ephemeral" | "edit";

export class SlackBot {
    private statusDao: StandupStatusDao;

    private viewBuilder = new BotViewBuilder();

    constructor(statusDao: StandupStatusDao) {
        this.statusDao = statusDao;
    }

    /**
     * Create the initial modal for entering a message
     * @param body
     * @param client
     */
    public async buildNewMessageModalView(body: SlashCommand, client: WebClient): Promise<ViewsOpenArguments> {
        const channelId = body.channel_id;

        const pm: PrivateMetadata = {
            channelId: channelId,
            userId: body.user_id,
            messageType: "post"
        };
        const userInfo = await this.queryUser(body.user_id, client);

        const trigger_id = body.trigger_id;

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo);
    }

    /**
     * Create a modal view to edit the message. Retrieve data for the message, format, and delegate to builder.
     *
     * Button payload must be
     *
     * `message + "#" + channelId + "#" + postAt + "#" + userId`
     *
     * @param command
     * @param triggerId
     * @param client
     */
    public async buildModalViewForPostUpdate(command: ChangeMessageCommand, triggerId: string, client: WebClient): Promise<ViewsOpenArguments> {
        const pm: PrivateMetadata = {
            channelId: command.channelId,
            userId: command.userId,
            messageId: command?.messageId,
            messageDate: command?.postAt,
            messageType: "edit"
        };

        const userInfo = await this.queryUser(pm.userId!, client);
        const trigger_id = triggerId;

        let blockData = await this.loadSavedStatus(command, pm);

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo, blockData);
    }

    public async buildModalViewForScheduleUpdate(command: ChangeMessageCommand, triggerId: string, client: WebClient): Promise<ViewsOpenArguments> {
        // Store the message ID for updating later
        const pm: PrivateMetadata = {
            channelId: command.channelId,
            userId: command.userId,
            messageId: command?.messageId,
            messageDate: command?.postAt,
            messageType: "scheduled"
        };

        const userInfo = await this.queryUser(pm.userId!, client);
        const trigger_id = triggerId;

        let blockData = await this.loadSavedStatus(command, pm);

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo, blockData);
    }

    private async loadSavedStatus(command: ChangeMessageCommand, pm: PrivateMetadata) {
        // TODO pass the command's message ID to get StandupStatus
        //const status = await this.getSavedStandupData(command.channelId, command.userId, new Date(command.postAt!), command.timezoneOffset);
        const status = new StandupStatus();
        let blockData: StandupViewData | undefined
        if (status) {
            blockData = new StandupViewData({
                pm: pm,
                attendees: status.parkingLotAttendees,
                dateStr: status.scheduleDateStr,
                parkingLot: status.parkingLot,
                pullRequests: status.pullRequests,
                today: status.today,
                timeStr: status.scheduleTimeStr,
                yesterday: status.yesterday,
            });
        }
        return blockData;
    }

    private ensureTimezoneOffset(timezone: string | number): number {
        if (typeof timezone === 'string') {
            return getTimezoneOffset(timezone);
        }
        return timezone;
    }
    private async getSavedStandupData(channelId: string, userId: string, date: Date, timezone: string | number) {
        let tzNum = this.ensureTimezoneOffset(timezone);
        return await this.statusDao.getChannelData(channelId, date, userId, tzNum);
    }

    /**
     * Handle interaction with the modal view. This is tightly coupled with data from the view builder.
     * @param view
     */
    public getViewInputValues(view: ViewOutput): StandupViewData {
        const pm = JSON.parse(view['private_metadata']) as PrivateMetadata;

        // Yesterday
        const yesterday = view['state']['values']['yesterday'][ACTION_NAMES.get("YESTERDAY")!].value!;
        // Today
        const today = view['state']['values']['today'][ACTION_NAMES.get("TODAY")!].value!;
        // Parking Lot
        const parkingLot = view['state']['values']['parking-lot'][ACTION_NAMES.get("PARKING_LOT")!].value;

        // Parking Lot Attendees
        // Get list of selected members
        const selectedMemberIds = view['state']['values']['parking-lot-participants'][ACTION_NAMES.get("PARTICIPANTS")!];

        // Pull Requests
        const pullRequests = view['state']['values']['pull-requests'][ACTION_NAMES.get("PULL_REQUESTS")!].value;

        let dateStr, timeStr, tz;
        let dateTime;
        // If a schedule date is on the page, retrieve data
        if (view['state']['values']['schedule-date']) {
            dateStr = view['state']['values']['schedule-date'][ACTION_NAMES.get("SCHEDULE_DATE")!]['selected_date'];
            timeStr = view['state']['values']['schedule-time'][ACTION_NAMES.get("SCHEDULE_TIME")!]['selected_time'];
            // Timezone is not available in the ViewStateValue interface
            // @ts-ignore
            tz = view['state']['values']['schedule-time'][ACTION_NAMES.get("SCHEDULE_TIME")!]['timezone'];
            // Convert to the correct UTC time based on passed timezone
            dateTime = adjustDateAndTimeForTimezone(dateStr, timeStr, tz);

            // We are creating a scheduled message
            pm.messageType = "scheduled";
        }

        const attendees = selectedMemberIds.selected_users!;

        return new StandupViewData({
            pm: pm,
            yesterday: yesterday,
            today: today,
            parkingLot: parkingLot,
            attendees: attendees,
            pullRequests: pullRequests,
            scheduleDateTime: dateTime,
            timezone: tz,
            dateStr: dateStr,
            timeStr: timeStr
        });
    }

    /**
     * Create the main message to display to the user after submitting modal.
     * @param viewInput
     * @param client
     */
    public async createChatMessage(viewInput: StandupViewData, client: WebClient):
        Promise<ChatPostMessageArguments | ChatScheduleMessageArguments | ChatUpdateArguments> {

        const channelId = viewInput.pm.channelId!;
        const userId = viewInput.pm.userId!;
        const ts = viewInput.pm.messageId;
        const messageType = viewInput.pm.messageType;

        const userInfo = await this.queryUser(userId, client);

        let memberInfos: UserInfo[] = [];
        if (viewInput.attendees.length > 0) {
            memberInfos = await this.queryUsers(viewInput.attendees, client);
        }

        const blocks = this.viewBuilder.buildChatMessageOutputBlocks(messageType, userInfo, viewInput.yesterday, viewInput.today, viewInput.parkingLot, viewInput.pullRequests, memberInfos);

        // post as the user who requested
        return {
            channel: channelId,
            username: userInfo.name,
            icon_url: userInfo.img,
            blocks: blocks,
            text: userInfo.name,
            mrkdwn: true,
            unfurl_links: false,
            unfurl_media: false,
            user: userId,
            ts: ts
        };
    }

    private viewInputToStatusData(viewInput: StandupViewData, messageType: StandupStatusType): StandupStatus {
        return new StandupStatus({
            messageId: viewInput.pm.messageId,
            yesterday: viewInput.yesterday,
            today: viewInput.today,
            pullRequests: viewInput.pullRequests ? viewInput.pullRequests : undefined,
            parkingLotAttendees: viewInput.attendees,
            parkingLot: viewInput.parkingLot ? viewInput.parkingLot : undefined,
            scheduleDateStr: viewInput.dateStr ? viewInput.dateStr : undefined,
            scheduleTimeStr: viewInput.timeStr ? viewInput.timeStr : undefined,
            messageType: messageType
        });
    }

    /**
     * Save the status data to the database. If one already exists, it will be overwritten.
     * @param viewInput
     * @param saveDate
     * @param messageType
     * @param timezone
     */
    public async saveStatusData(viewInput: StandupViewData, saveDate: Date, messageType: StandupStatusType, timezone: number | string) {
        const tz = this.ensureTimezoneOffset(timezone);
        const status = this.viewInputToStatusData(viewInput, messageType);
        try {
            const existingData = await this.statusDao.getChannelData(viewInput.pm.channelId!, saveDate, viewInput.pm.userId!, tz);
            if (existingData) {
                logger.info("Found existing data for " + viewInput.pm.channelId! + " " + saveDate + " " + viewInput.pm.userId! + ". Overwriting.")
                await this.statusDao.updateData(viewInput.pm.channelId!, saveDate, viewInput.pm.userId!, status, tz);
            } else {
                await this.statusDao.putData(viewInput.pm.channelId!, saveDate, viewInput.pm.userId!, status, tz);
            }

        } catch (e) {
            logger.error(e);
        }
    }

    public async buildParkingLotDisplayData(channelId: string, date: Date, timezoneOffset: number, client: WebClient): Promise<string> {
        const statuses = await this.statusDao.getChannelDataForDate(channelId, date, timezoneOffset);

        let displayItems: ParkingLotDisplayItem[] = [];
        let proms = statuses.filter(s => s.parkingLot || s.parkingLotAttendees && s.parkingLotAttendees.length > 0).map(async i => {
            let item = new ParkingLotDisplayItem();
            let u = await this.queryUser(i.userId, client);
            item.userName = u.name;
            item.attendeeIds = i.parkingLotAttendees ? i.parkingLotAttendees : [];
            item.content = i.parkingLot ? i.parkingLot : "";
            return item;
        });
        displayItems = await Promise.all(proms);

        return this.viewBuilder.buildParkingLotDisplayItems(displayItems);
    }

    private async queryUsers(users: string[], client: WebClient): Promise<UserInfo[]> {
        const memberInfosProm = users?.map(m => {
            return this.queryUser(m, client);
        });

        return await Promise.all(memberInfosProm!);
    }

    private async queryUser(user: string, client: WebClient): Promise<UserInfo> {
        const resp = await client.users.info({
            user: user
        });

        return {
            name: resp.user?.real_name!,
            userId: user,
            img: resp.user?.profile?.image_72,
            timezone: resp.user?.tz!
        }
    }

    public buildChatMessageEditDialog(cmd: ChangeMessageCommand) {
        const channelId = cmd.channelId;
        const userId = cmd.userId;
        const msg = "Edit Status";
        const blocks = this.viewBuilder.buildChatMessageEditBlocks(cmd, msg);
        return {
            channel: channelId,
            user: userId,
            blocks: blocks,
            text: msg
        }
    }

    public buildScheduledMessageDialog(cmd: ChangeMessageCommand, timezone: string, args: ChatScheduleMessageArguments): ChatPostEphemeralArguments {
        const dateStr = formatDateToPrintable(cmd.postAt, timezone);
        const msg = "Your status below is scheduled to send on\n " + dateStr;

        const blocks = this.viewBuilder.buildScheduledMessageDialog(cmd, timezone, args, msg);
        return {
            channel: cmd.channelId,
            user: cmd.userId,
            text: msg,
            blocks: blocks
        }
    }

    public buildEphemeralContextMessage(channelId: string, userId: string, message: string): ChatPostEphemeralArguments {
        const msg = this.viewBuilder.buildSimpleContextBlock(message);
        return {
            channel: channelId,
            user: userId,
            blocks: [msg],
            text: message
        }
    }

    /**
     * Delete the message based on its ID. Button payload must be
     *
     * `messageId + "#" + channelId + "#" + postAt + "#" + userId`
     *
     * When attempting to delete, if the message ID is not found, this rethrows an error with user-friendly message.
     *
     * @param command
     * @param client
     * @param logger
     */
    public async deleteScheduledMessage(command: ChangeMessageCommand, client: WebClient, logger: Logger): Promise<ChatPostEphemeralArguments | string> {
        logger.info(`Deleting message ${command?.messageId} for channel ${command?.channelId} on date ${command?.postAt} for user ${command?.userId}`);

        if (command) {
            try {
                const result = await client.chat.deleteScheduledMessage(
                    {
                        channel: command.channelId,
                        scheduled_message_id: command.messageId,
                    }
                );
                if (result.ok) {
                    const msg = `Status with Slack message ID ${command.messageId} deleted`;
                    return {
                        channel: command.channelId,
                        text: msg,
                        mrkdwn: true,
                        unfurl_links: false,
                        unfurl_media: false,
                        user: command.userId
                    };
                }
                return result.error!.toString();
            } catch (e) {
                let errorMsg = (e as Error).message;
                if(errorMsg.includes("invalid_scheduled_message_id")) {
                    errorMsg = "No scheduled message found for that status. Perhaps it was already deleted.";
                    e = new Error(errorMsg);
                }
                throw e;
            } finally {
                // also clean up the parking lot items
                // TODO use the message ID to find and delete the status
                // const tz = this.getTimezoneOffset(command.timezoneOffset!);
                // await this.statusDao.removeStandupStatusData(command.channelId, new Date(command.postAt!), command.userId, tz);
            }
        }
        return "Invalid delete command";
    }

    public buildErrorView(msg: string): ModalView {
        return this.viewBuilder.buildErrorView(msg);
    }

    public buildErrorMessage(channelId: string, userId: string, msg: string): ChatPostEphemeralArguments {
        return this.viewBuilder.buildErrorMessage(channelId, userId, msg);
    }

    async validateBotUserInChannel(channelId: string, botId: string, client: WebClient): Promise<boolean> {
        const channelData = await client.conversations.members({
            channel: channelId,
        });
        // Get data about this bot to compare its usersID against the list
        const botData = await client.bots.info({
            bot: botId
        })
        const botUserId = botData.bot?.user_id;
        return !!channelData.members?.find(m => {
            return m === botUserId;
        });
    }

    public getUserTimezone(userId: string, client: WebClient): Promise<string> {
        return client.users.info({
            user: userId
        }).then(resp => {
            return resp.user?.tz!;
        });
    }
    public getUserTimezoneOffset(userId: string, client: WebClient): Promise<number> {
        return client.users.info({
            user: userId
        }).then(resp => {
            return resp.user?.tz_offset! / 60; // convert to minutes
        });
    }
}