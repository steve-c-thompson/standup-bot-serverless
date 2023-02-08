import {
    Logger,
    ModalView,
    SlashCommand,
    ViewOutput,
} from "@slack/bolt";
import {
    ChatPostMessageArguments,
    ChatScheduleMessageArguments,
    ChatUpdateArguments,
    ViewsOpenArguments,
    WebClient
} from "@slack/web-api";
import {StandupParkingLotDataDao} from "../data/StandupParkingLotDataDao";
import {StandupParkingLotData} from "../data/StandupParkingLotData";
import {BotViewBuilder, ParkingLotDisplayItem} from "./BotViewBuilder";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {adjustDateAndTimeForTimezone, formatDateToPrintable} from "../utils/datefunctions";
import {ChangePostedMessageCommand, ChangeScheduledMessageCommand, MessageCommand} from "./Commands";
import {StandupViewData} from "../dto/StandupViewData";
import {UserInfo} from "../dto/UserInfo";
import {ACTION_NAMES} from "./ViewConstants";
import {PrivateMetadata} from "../dto/PrivateMetadata";
import {logger} from "../utils/context";

export type StandupMessageType = "scheduled" | "post" | "ephemeral" | "edit";

export class SlackBot {
    private parkingLotDataDao: StandupParkingLotDataDao;


    private viewBuilder = new BotViewBuilder();

    constructor(parkingLotDataDao: StandupParkingLotDataDao) {
        this.parkingLotDataDao = parkingLotDataDao;
    }

    /**
     * Create the initial modal for entering a message
     * @param body
     * @param client
     */
    public async buildNewMessageModalView(body: SlashCommand, client:WebClient): Promise<ViewsOpenArguments> {
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
     * `ts + "#" + channelId + "#" + "#" + userId`
     *
     * @param command
     * @param triggerId
     * @param client
     * @param logger
     */
    public async buildModalViewForPostUpdate(command: ChangePostedMessageCommand, triggerId: string, client:WebClient): Promise<ViewsOpenArguments>{
        // Store the message ID for updating on submit
        const pm: PrivateMetadata = {
            channelId: command.channelId,
            userId: command.userId,
            messageId: command?.ts,
            messageType: "edit"
        };

        const userInfo = await this.queryUser(pm.userId!, client);
        const trigger_id = triggerId;

        // TODO Get existing data and load into StandupViewData
        const blockData: StandupViewData = {
            pm: pm,
            attendees: [],
            dateStr: "",
            parkingLot: "",
            pullRequests: "",
            timeStr: "",
            timezone: "",
            today: "",
            yesterday: "",
        }

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo, blockData);
    }

    public async buildModalViewForScheduleUpdate(command: ChangeScheduledMessageCommand, triggerId: string, client:WebClient): Promise<ViewsOpenArguments>{
        // Store the message ID for updating later
        const pm: PrivateMetadata = {
            channelId: command.channelId,
            userId: command.userId,
            messageId: command?.messageId,
            messageType: "scheduled"
        };

        const userInfo = await this.queryUser(pm.userId!, client);
        const trigger_id = triggerId;

        // TODO Get existing data and load into StandupViewData
        // const blockData: StandupViewData = {
        //     pm: pm,
        //     attendees: ["U02AZ5GPTQW"],
        //     dateStr: "2023-02-10",
        //     parkingLot: "A parking lot item",
        //     pullRequests: "PRs",
        //     timeStr: "11:55",
        //     timezone: "America/Denver",
        //     today: "Today text",
        //     yesterday: "Yesterday Text",
        // }
        const blockData: StandupViewData = {
            pm: pm,
            attendees: [],
            dateStr: "",
            parkingLot: "",
            pullRequests: "",
            timeStr: "",
            timezone: "",
            today: "",
            yesterday: "",
        }

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo, blockData);
    }

    // TODO need StandupData class from DB
    private getSavedStandupData(channelId: string, userId: string, date: Date) {

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
        if(view['state']['values']['schedule-date']){
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

        return {
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
        }
    }

    /**
     * Create the main message to display to the user after submitting modal.
     * @param viewInput
     * @param client
     */
    public async createChatMessageAndSaveData(viewInput: StandupViewData, client: WebClient):
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

        try {
            const saveDate = viewInput.scheduleDateTime ? new Date(viewInput.scheduleDateTime) : new Date();
            await this.saveParkingLotData(channelId, saveDate, userId, viewInput.parkingLot, memberInfos);
        } catch (e) {
            logger.error(e);
        }

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

    public async buildParkingLotDisplayData(channelId: string, date: Date, client: WebClient): Promise<string> {
        let p: StandupParkingLotData | null = await this.parkingLotDataDao.getChannelDataForDate(channelId, date);
        let displayItems: ParkingLotDisplayItem[] = [];
        if (p) {
            let proms = p.parkingLotData!.map(async i => {
                let item = new ParkingLotDisplayItem();
                let u = await this.queryUser(i.userId, client);
                item.userName = u.name;
                item.attendeeIds = i.attendees? i.attendees : [];
                item.content = i.content;
                return item;
            });
            displayItems = await Promise.all(proms);
        }
        return this.viewBuilder.buildParkingLotDisplayItems(displayItems);
    }

    public async saveParkingLotData(channelId: string,
                                    date: Date,
                                    userId: string,
                                    parkingLotItems: string | null | undefined,
                                    parkingLotAttendees: UserInfo[]) {
        const pla = parkingLotAttendees.map(u => {
            return u.userId!;
        })
        await this.parkingLotDataDao.upsertStandupParkingLotData(channelId, date, userId, parkingLotItems, pla);
    }

    private async queryUsers(users: string[], client: WebClient): Promise<UserInfo[]> {
        const memberInfosProm = users?.map(m => {
            return this.queryUser(m, client);
        });

        return await Promise.all(memberInfosProm!);
    }

    private async queryUser(user: string, client: WebClient) : Promise<UserInfo> {
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

    public buildChatMessageEditDialog(cmd: MessageCommand) {
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

    public buildScheduledMessageDialog(cmd: ChangeScheduledMessageCommand, timezone: string, args: ChatScheduleMessageArguments) : ChatPostEphemeralArguments {
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
     * @param command
     * @param client
     * @param logger
     */
    public async deleteScheduledMessage(command: ChangeScheduledMessageCommand, client: WebClient, logger: Logger) : Promise<ChatPostEphemeralArguments | string> {
        logger.info(`Deleting message ${command?.messageId} for channel ${command?.channelId}`);
        if(command) {
            try {
                const result = await client.chat.deleteScheduledMessage(
                    {
                        channel: command.channelId,
                        scheduled_message_id: command.messageId,
                    }
                );
                if(result.ok) {
                    const msg = `Status with message ID ${command.messageId} deleted`;
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
            }
            catch(e) {
                logger.error(e);
                throw e;
            }
            finally {
                // also clean up the parking lot items
                logger.info(`Removing Standup Parking Lot Data ${command.channelId} ${command.postAt} ${command.userId}`);
                await this.parkingLotDataDao.removeStandupParkingLotData(command.channelId, new Date(command.postAt!), command.userId);
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

}