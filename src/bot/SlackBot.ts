import {Block, Logger, ModalView, SlashCommand, ViewOutput,} from "@slack/bolt";
import {
    ChannelsInfoResponse, ChatDeleteScheduledMessageResponse,
    ChatPostMessageArguments,
    ChatScheduleMessageArguments,
    ChatUpdateArguments, KnownBlock,
    ViewsOpenArguments,
    WebAPICallOptions, WebAPICallResult,
    WebClient
} from "@slack/web-api";
import {BotViewBuilder, ParkingLotDisplayItem} from "./BotViewBuilder";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {adjustDateAndTimeForTimezone, formatDateToPrintableWithTime, getTimezoneOffset} from "../utils/datefunctions";
import {ChangeMessageCommand} from "./Commands";
import {StandupViewData} from "../dto/StandupViewData";
import {UserInfo} from "../dto/UserInfo";
import {ACTION_NAMES} from "./ViewConstants";
import {PrivateMetadata} from "../dto/PrivateMetadata";
import {logger} from "../utils/appContext";
import {StandupStatusDao} from "../data/StandupStatusDao";
import {StandupStatusType, StatusMessage} from "../data/StandupStatus";

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
            messageType: "posted"
        };
        const userInfo = await this.queryUser(body.user_id, client);

        const trigger_id = body.trigger_id;

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo);
    }

    /**
     * Create a modal view to edit the message. Retrieve data for the message, format, and delegate to builder.
     *
     * @param command
     * @param triggerId
     * @param client
     */
    public async buildModalViewForPostUpdate(command: ChangeMessageCommand, triggerId: string, client: WebClient): Promise<ViewsOpenArguments> {
        return this.loadModalViewForUpdate(command.channelId, command.userId, command.messageId!, command.postAt, triggerId, "posted", client);
    }

    public async buildModalViewForScheduleUpdate(command: ChangeMessageCommand, triggerId: string, client: WebClient): Promise<ViewsOpenArguments> {
        return this.loadModalViewForUpdate(command.channelId, command.userId, command.messageId!, command.postAt, triggerId, "scheduled", client);
    }

    private async loadModalViewForUpdate(channelId: string, userId: string, messageId: string, postAt: number, triggerId: string, messageType: StandupStatusType, client: WebClient): Promise<ViewsOpenArguments> {
        logger.info(`Loading modal view for update: ${channelId}, ${userId}, ${messageId}, ${postAt}, ${messageType} triggerId: ${triggerId}`);
        const pm: PrivateMetadata = {
            channelId: channelId,
            userId: userId,
            messageId: messageId,
            messageType: messageType,
            messageDate: postAt
        };

        const status = await this.statusDao.getStatusMessage(userId, messageId);

        const userInfo = await this.queryUser(userId, client);

        let blockData = await this.loadSavedStatusMessage(status, pm);

        return this.viewBuilder.buildModalInputView(triggerId, pm, userInfo, blockData);
    }

    private async loadSavedStatusMessage(status: StatusMessage | undefined, pm: PrivateMetadata) {
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

    private viewInputToStatusData(viewInput: StandupViewData, messageType: StandupStatusType): StatusMessage {
        return new StatusMessage({
            messageId: viewInput.pm.messageId!,
            yesterday: viewInput.yesterday,
            today: viewInput.today,
            pullRequests: viewInput.pullRequests ? viewInput.pullRequests : undefined,
            parkingLotAttendees: viewInput.attendees,
            parkingLot: viewInput.parkingLot ? viewInput.parkingLot : undefined,
            scheduleDateStr: viewInput.dateStr ? viewInput.dateStr : undefined,
            scheduleTimeStr: viewInput.timeStr ? viewInput.timeStr : undefined,
            messageType: messageType,
            messageDate: new Date(viewInput.pm.messageDate!),
            channelId: viewInput.pm.channelId!,
            userId: viewInput.pm.userId!,
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
        const statusMsg = this.viewInputToStatusData(viewInput, messageType);
        try {
            await this.statusDao.addStatusMessage(viewInput.pm.channelId!, saveDate, viewInput.pm.userId!, statusMsg, tz);
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

        let displayItems: ParkingLotDisplayItem[] = [];
        let statsWithParkingLots = statuses.filter(s => s.statusMessages.filter(m => m.parkingLot || m.parkingLotAttendees && m.parkingLotAttendees.length > 0).length > 0);

        // iterate through each status and map parkingLot with statusMessages to a display item
        class DisplayItem {
            userId: string
            parkingLot: string
            attendees: string[]
        }

        const displayItemsArr: DisplayItem[] = [];
        statsWithParkingLots.forEach(s => {
            let sms = s.statusMessages.filter(m => m.parkingLot || m.parkingLotAttendees && m.parkingLotAttendees.length > 0);
            sms.map(sm => {
                displayItemsArr.push({
                    userId: s.userId,
                    parkingLot: sm.parkingLot!,
                    attendees: sm.parkingLotAttendees!
                });
            });
        });
        const proms = displayItemsArr.map(async di => {
            const userInfo = await this.queryUser(di.userId, client);
            let item = new ParkingLotDisplayItem();
            item.userName = userInfo.name;
            item.attendeeIds = di.attendees;
            item.content = di.parkingLot;
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
     * @deprecated We don't use this any more to avoid having the buttons in the chat dialog.
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

    private buildScheduledMessageConfirmation(cmd: ChangeMessageCommand, timezone: string) {
        const dateStr = formatDateToPrintableWithTime(cmd.postAt, timezone);
        const msg = "Your status is scheduled to send on\n " + dateStr;
        return msg;
    }

    /***
     * Build the scheduled message confirmation and link blocks, for sending via the chat API. This outputs
     * message contents and then a link to the app home tab.
     * @param cmd
     * @param timezone
     * @param appId
     * @param teamId
     * @param messageContents
     */
    public buildScheduledMessageConfirmationAndLink(cmd: ChangeMessageCommand, timezone: string, appId: string, teamId: string, messageContents: (Block | KnownBlock)[]): ChatPostEphemeralArguments {
        const blocks = [...messageContents];
        const msg = this.buildScheduledMessageConfirmation(cmd, timezone);
        const msgBlock: KnownBlock = {
            type: "context",
            elements: [{
                type: "mrkdwn",
                text: msg
            }]
        };
        blocks.push(msgBlock);

        const linkBlocks = this.buildAppHomeLinkBlocks(appId, teamId);

        blocks.push(...linkBlocks);
        return {
            text: msg,
            blocks: blocks,
            channel: cmd.channelId,
            user: cmd.userId
        }
    }

    buildAppHomeLinkBlocks(appId: string, teamId: string)  {
        const link = this.buildAppHomeLink(appId, teamId);
        const linkBlocks = [this.viewBuilder.buildSimpleContextBlock(link)];
        return linkBlocks;
    }

    /**
     * Build an ephemeral message for the user, for sending via the chat API.
     * @param channelId
     * @param userId
     * @param blocks
     * @param message
     */
    public buildEphemeralContextMessage(channelId: string, userId: string, blocks: Block[] = [], message?: string): ChatPostEphemeralArguments {
        if(message){
            const msg = this.viewBuilder.buildSimpleContextBlock(message);
            blocks.unshift(msg);
        }
        else {
            message = " ";
        }
        return {
            channel: channelId,
            user: userId,
            blocks: blocks,
            text: message
        }
    }

    /**
     * Delete the message based on its ID, which is sent in the command. Return an ephemeral message.
     *
     * @param command
     * @param client
     * @param logger
     */
    public async deleteScheduledMessage(command: ChangeMessageCommand, client: WebClient, logger: Logger): Promise<ChatPostEphemeralArguments | ChatPostMessageArguments> {
        if (command) {
            try {
                const status = await this.statusDao.getStatusMessage(command.userId, command.messageId);
                if (status) {
                    return await this.deleteMessageFromSlack(logger, command, command.userId, command.channelId, client);
                } else {
                    logger.info(`No status found in the database for message ID ${command.messageId}`);
                    // Try and delete anyway, in case the message was removed from the DB but not Slack
                    const msg = `No status found in the database  for message ID ${command.messageId}. Attempting to delete from Slack.`;
                    return await this.deleteMessageFromSlack(logger, command, command.userId, command.channelId, client, msg);
                }
            } catch (e) {
                let errorMsg = (e as Error).message;
                if (errorMsg.includes("invalid_scheduled_message_id")) {
                    errorMsg = "No scheduled message found for that status. Perhaps it was already deleted.";
                    e = new Error(errorMsg);
                }
                throw e;
            } finally {
                // also clean up the parking lot items
                logger.info(`Removing StandupStatus with message ID ${command.messageId}`);
                await this.statusDao.removeStandupStatusMessageByUserIdAndMessageId(command.userId, command.messageId);
            }
        }
        return this.buildErrorMessage("NO CHANNEL", "NO USER", "Invalid delete command");
    }

    private async deleteMessageFromSlack(logger: Logger, command: ChangeMessageCommand, userId: string, channelId: string, client: WebClient, message?: string): Promise<ChatPostEphemeralArguments | ChatPostMessageArguments> {
        logger.info(`Deleting message ${command?.messageId} for user ${userId} in channel ${channelId}`);
        const result = await this.messageWithSlackApi(command.userId, new Date(command.postAt), client, "chat.deleteScheduledMessage",
            {
                channel: channelId,
                scheduled_message_id: command.messageId,
            }
        ) as ChatDeleteScheduledMessageResponse;
        if (result.ok) {
            let msg = `Status with Slack message ID ${command.messageId} deleted from Slack.`;
            if (message) {
                msg = message + "\n" + msg;
            }
            return {
                channel: channelId,
                text: msg,
                mrkdwn: true,
                unfurl_links: false,
                unfurl_media: false,
                user: userId
            };
        }
        return this.buildErrorMessage(channelId, userId, result.error!.toString());
    }

    /**
     * Delegate to viewBuilder to build a simple error message modal view.
     * @param msg
     */
    public buildErrorView(msg: string): ModalView {
        return this.viewBuilder.buildErrorView(msg);
    }

    /**
     * Delegate to viewBuilder to build a simple error message for ephemeral or chat messages.
     * @param channelId
     * @param userId
     * @param msg
     */
    public buildErrorMessage(channelId: string, userId: string, msg: string): ChatPostEphemeralArguments | ChatPostMessageArguments {
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
    public async getUserTimezoneOffset(userId: string, client: WebClient): Promise<number> {
        return client.users.info({
            user: userId
        }).then(resp => {
            return resp.user?.tz_offset! / 60; // convert to minutes
        });
    }

    /**
     * Update the home screen by finding all current messages for the user, and building and posting the home screen.
     * @param userId
     * @param today
     * @param client
     */
    public async updateHomeScreen(userId: string, today: Date, client: WebClient): Promise<void> {
        try {
            const tzOffset = await this.getUserTimezoneOffset(userId, client);
            const messages = await this.statusDao.getStandupStatusesByUserId(userId, today, tzOffset);

            logger.debug("Messages: " + JSON.stringify(messages, null, 2));
            // delegate to view builder to build the home screen with messages and appropriate buttons
            const userInfo = await this.queryUser(userId, client);
            // Iterate through all parking lots to get attendees
            let attendees = messages.filter(m => m.statusMessages.length > 0).flatMap(s => {
                return s.statusMessages.filter(sm => sm.parkingLotAttendees && sm.parkingLotAttendees.length > 0).flatMap(sm => {
                    return sm.parkingLotAttendees!;
                })
            });
            attendees = attendees.filter(a => !!a);
            const userInfos = await this.queryUsers(attendees, client);

            // Find the names of channels
            let channelIds = messages.map(m => m.channelId);
            channelIds = [...new Set(channelIds)]; // remove duplicates
            const channelIdNameMap = await this.queryChannels(channelIds, client);
            const homeScreen = this.viewBuilder.buildHomeScreen(messages, userInfo, userInfos, channelIdNameMap, today, tzOffset);

            // post the home screen
            await client.views.publish({
                user_id: userId,
                view: homeScreen
            });
        } catch (e) {
            logger.error("Error updating home screen: " + e);
        }
    }

    /**
     * This abstraction exists to allow consistent update of the home screen after a message is sent.
     * @param userId
     * @param today
     * @param client
     * @param method
     * @param args
     * @param updateHomeScreen
     */
    async messageWithSlackApi(userId: string, today: Date, client: WebClient, method: string, args: WebAPICallOptions,
                              updateHomeScreen: boolean = false): Promise<WebAPICallResult> {
        const result = await client.apiCall(method, args);
        if (updateHomeScreen) {
            try {
                logger.info("Updating home screen after messageWithSlackApi call");
                await this.updateHomeScreen(userId, today, client);
            } catch (e) {
                logger.error("Error updating home screen: " + e);
            }
        }
        return result;
    }

    private async queryChannels(channelIds: string[], client: WebClient): Promise<Map<string, string>> {
        const channelInfosProm = channelIds?.map(c => {
            return client.conversations.info({channel: c});
        });

        const channelInfos: ChannelsInfoResponse[] = await Promise.all(channelInfosProm!);
        const channelMap = new Map<string, string>();
        channelInfos.forEach(c => {
            channelMap.set(c.channel!.id!, c.channel!.name!);
        });
        return channelMap;
    }

    private buildAppHomeLink(appId: string, teamId: string | null): string {
        const linkMsg = ["Manage your standup status messages in the ", "Standup App's Home tab"];
        if (!teamId) {
            return linkMsg.join("");
        }
        return `${linkMsg[0]}<slack://app?team=${teamId}&id=${appId}&tab=home|${linkMsg[1]}>`;
    }
}