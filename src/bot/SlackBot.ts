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
     * @param command
     * @param channelId
     * @param userId
     * @param triggerId
     * @param client
     */
    public async buildModalViewForPostUpdate(command: ChangeMessageCommand, channelId: string, userId: string,triggerId: string, client: WebClient): Promise<ViewsOpenArguments> {
        return this.loadModalViewForUpdate(channelId, userId, command.messageId!, command.postAt, triggerId, "edit", client);
    }

    public async buildModalViewForScheduleUpdate(command: ChangeMessageCommand, channelId: string, userId: string,triggerId: string, client: WebClient): Promise<ViewsOpenArguments> {
        return this.loadModalViewForUpdate(channelId, userId, command.messageId!, command.postAt, triggerId, "scheduled", client);
    }

    private async loadModalViewForUpdate(channelId: string, userId: string, messageId: string, postAt: number, triggerId: string,  messageType: StandupDialogMessageType, client: WebClient): Promise<ViewsOpenArguments> {
        const pm: PrivateMetadata = {
            channelId: channelId,
            userId: userId,
            messageId: messageId,
            messageType: messageType,
            messageDate: postAt
        };

        const trigger_id = triggerId;

        const status = await this.getSavedStandupForMessageId(messageId);

        const userInfo = await this.queryUser(userId, client);

        let blockData = await this.loadSavedStatus(status, pm);

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo, blockData);
    }

    private async loadSavedStatus(status: StandupStatus | null, pm: PrivateMetadata) {
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

    private async getSavedStandupForMessageId(messageId: string) : Promise<StandupStatus | null> {
        return await this.statusDao.getStandupStatusByMessageId(messageId);
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
     * @param viewInput The data from the modal view
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
                logger.info("Found existing data for " + viewInput.pm.channelId! + " " + saveDate + " userId " + viewInput.pm.userId! + ". Overwriting.")
                await this.statusDao.updateData(viewInput.pm.channelId!, saveDate, viewInput.pm.userId!, status, tz);
            } else {
                await this.statusDao.putData(viewInput.pm.channelId!, saveDate, viewInput.pm.userId!, status, tz);
            }

        } catch (e) {
            logger.error(e);
        }
    }

    /**
     * Build the data to display parking lot contents.
     * @param channelId
     * @param date
     * @param timezoneOffset
     * @param client
     */
    public async buildParkingLotDisplayData(channelId: string, date: Date, timezoneOffset: number, client: WebClient): Promise<string> {
        const statuses = await this.statusDao.getChannelDataForDate(channelId, date, timezoneOffset);

        let displayItems: ParkingLotDisplayItem[];
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

    /**
     * Build the edit message blocks, for sending via the chat API.
     * @param cmd
     * @param channelId
     * @param userId
     */
    public buildChatMessageEditDialog(cmd: ChangeMessageCommand, channelId: string, userId: string) {
        const msg = "Edit Status";
        const blocks = this.viewBuilder.buildChatMessageEditBlocks(cmd, msg);
        return {
            channel: channelId,
            user: userId,
            blocks: blocks,
            text: msg
        }
    }

    /**
     * Build the scheduled message dialog and blocks, for sending via the chat API.
     * @param cmd
     * @param channelId
     * @param userId
     * @param timezone
     * @param args
     */
    public buildScheduledMessageDialog(cmd: ChangeMessageCommand, channelId: string, userId: string, timezone: string, args: ChatScheduleMessageArguments): ChatPostEphemeralArguments {
        const dateStr = formatDateToPrintable(cmd.postAt, timezone);
        const msg = "Your status below is scheduled to send on\n " + dateStr;

        const blocks = this.viewBuilder.buildScheduledMessageDialog(cmd, timezone, args, msg);

        return {
            channel: channelId,
            user: userId,
            text: msg,
            blocks: blocks
        }
    }

    /**
     * Build an ephemeral message for the user, for sending via the chat API.
     * @param channelId
     * @param userId
     * @param message
     */
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
     * Delete the message based on its ID, which is sent in the command.
     *
     * @param command
     * @param channelId
     * @param userId
     * @param client
     * @param logger
     */
    public async deleteScheduledMessage(command: ChangeMessageCommand, channelId: string, userId: string, client: WebClient, logger: Logger): Promise<ChatPostEphemeralArguments> {

        if (command) {
            try {
                const status = await this.statusDao.getStandupStatusByMessageId(command.messageId);
                if (status) {
                    logger.info(`Deleting message ${command?.messageId} for user ${status?.userId} in channel ${status?.channelId}`);
                    const result = await client.chat.deleteScheduledMessage(
                        {
                            channel: status.channelId,
                            scheduled_message_id: command.messageId,
                        }
                    );
                    if (result.ok) {
                        const msg = `Status with Slack message ID ${command.messageId} deleted`;
                        return {
                            channel: status.channelId,
                            text: msg,
                            mrkdwn: true,
                            unfurl_links: false,
                            unfurl_media: false,
                            user: status.userId
                        };
                    }
                    return this.buildErrorMessage(channelId, userId, result.error!.toString());
                }
                else {
                    logger.info(`No status found for message ID ${command.messageId}`);
                    return this.buildErrorMessage(channelId, userId,`No status found for message ID ${command.messageId}. Perhaps it was already deleted.`);
                }
            } catch (e) {
                let errorMsg = (e as Error).message;
                if(errorMsg.includes("invalid_scheduled_message_id")) {
                    errorMsg = "No scheduled message found for that status. Perhaps it was already deleted.";
                    e = new Error(errorMsg);
                }
                throw e;
            } finally {
                // also clean up the parking lot items
                logger.info(`Removing StandupStatus with message ID ${command.messageId}`);
                await this.statusDao.removeStandupStatusByMessageId(command.messageId);
            }
        }
        return this.buildErrorMessage(channelId, userId,"Invalid delete command");
    }

    /**
     * Delegate to viewBuilder to build a simple error message modal view.
     * @param msg
     */
    public buildErrorView(msg: string): ModalView {
        return this.viewBuilder.buildErrorView(msg);
    }

    /**
     * Delegate to viewBuilder to build a simple error message for ephemeral messages.
     * @param channelId
     * @param userId
     * @param msg
     */
    public buildErrorMessage(channelId: string, userId: string, msg: string): ChatPostEphemeralArguments {
        return this.viewBuilder.buildErrorMessage(channelId, userId, msg);
    }

    /**
     * Validate that the bot is a member of the channel. Returns true if it is, false otherwise.
     * @param channelId
     * @param botId
     * @param client
     */
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

    /**
     * Get the user's timezone offset in minutes.
     * @param userId
     * @param client
     */
    public getUserTimezoneOffset(userId: string, client: WebClient): Promise<number> {
        return client.users.info({
            user: userId
        }).then(resp => {
            return resp.user?.tz_offset! / 60; // convert to minutes
        });
    }
}