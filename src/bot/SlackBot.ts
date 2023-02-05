import {BlockAction, ButtonAction, Logger, ModalView, SlashCommand, ViewOutput} from "@slack/bolt";
import {ChatPostMessageArguments, ChatScheduleMessageArguments, ViewsOpenArguments, WebClient} from "@slack/web-api";
import {StandupParkingLotDataDao} from "../data/StandupParkingLotDataDao";
import {StandupParkingLotData} from "../data/StandupParkingLotData";
import {BotViewBuilder, DeleteCommand, ParkingLotDisplayItem} from "./BotViewBuilder";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {adjustDateAndTimeForTimezone} from "../utils/datefunctions";

export class StandupInputData {
    pm: PrivateMetadata
    yesterday: string
    today: string
    parkingLot?: string | null | undefined
    attendees: string[] = []
    pullRequests?: string | null | undefined
    scheduleDateTime?: number | null | undefined
    timezone?: string
}

export class UserInfo {
    name: string
    userId: string
    img?: string
    timezone: string
}

export type ChatMessageType = "scheduled" | "post" | "ephemeral";

export class SlackBot {
    private dao: StandupParkingLotDataDao;

    private viewBuilder = new BotViewBuilder();

    constructor(dao: StandupParkingLotDataDao) {
        this.dao = dao;
    }

    /**
     * Create the initial modal view. block_id and action_id are hardcoded.
     * @param body
     * @param client
     * @param logger
     */
    public async buildModalView(body: SlashCommand, client:WebClient, logger: Logger): Promise<ViewsOpenArguments> {
        const channelId = body.channel_id;

        const pm: PrivateMetadata = {
            channelId: channelId,
            userId: body.user_id
        };

        const userInfo = await this.queryUser(body.user_id, client);

        const trigger_id = body.trigger_id;

        return this.viewBuilder.buildModalInputView(trigger_id, pm, userInfo);
    }

    /**
     * Handle interaction with the modal view. This is tightly coupled with data from the view builder.
     * @param view
     */
    public getViewInputValues(view: ViewOutput): StandupInputData {
        const pm = JSON.parse(view['private_metadata']) as PrivateMetadata;

        // Yesterday
        const yesterday = view['state']['values']['yesterday']['yesterday-action'].value!;
        // Today
        const today = view['state']['values']['today']['today-action'].value!;
        // Parking Lot
        const parkingLot = view['state']['values']['parking-lot']['parking-lot-action'].value;

        // Parking Lot Attendees
        // Get list of selected members
        const selectedMemberIds = view['state']['values']['parking-lot-participants']['parking-lot-participants-action'];

        // Pull Requests
        const pullRequests = view['state']['values']['pull-requests']['pull-requests-action'].value;

        const dateStr = view['state']['values']['schedule-date']['schedule-date-action']['selected_date'];
        const timeStr = view['state']['values']['schedule-time']['schedule-time-action']['selected_time'];
        // Timezone is not available in the ViewStateValue interface
        // @ts-ignore
        const tz = view['state']['values']['schedule-time']['schedule-time-action']['timezone'];

        let dateTime;
        // Convert to the correct UTC time based on passed timezone
        dateTime = adjustDateAndTimeForTimezone(dateStr, timeStr, tz);
        const attendees = selectedMemberIds.selected_users!;

        return {
            pm: pm,
            yesterday: yesterday,
            today: today,
            parkingLot: parkingLot,
            attendees: attendees,
            pullRequests: pullRequests,
            scheduleDateTime: dateTime,
            timezone: tz
        }
    }

    /**
     * Create the main message to display to the user after submitting modal.
     * @param messageType
     * @param viewInput
     * @param client
     * @param logger
     */
    public async createChatMessageAndSaveData(messageType: ChatMessageType, viewInput: StandupInputData, client: WebClient, logger: Logger): Promise<ChatPostMessageArguments | ChatScheduleMessageArguments> {
        // channel_id and user_id stored from submit
        const channelId = viewInput.pm.channelId!;
        const userId = viewInput.pm.userId!;

        const userInfo = await this.queryUser(userId, client);

        let memberInfos: UserInfo[] = [];
        if (viewInput.attendees.length > 0) {
            memberInfos = await this.queryUsers(viewInput.attendees, client);
        }

        const blocks = this.viewBuilder.buildChatMessageOutputBlocks(messageType, userInfo, viewInput.yesterday, viewInput.today, viewInput.parkingLot, viewInput.pullRequests, memberInfos, logger);

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
            user: userId
        };
    }

    public async buildParkingLotDisplayData(channelId: string, date: Date, client: WebClient): Promise<string> {
        let p: StandupParkingLotData | null = await this.dao.getChannelParkingLotDataForDate(channelId, date);
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
        await this.dao.upsertStandupParkingLotData(channelId, date, userId, parkingLotItems, pla);
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

    public createChatMessageEditDisclaimer(viewInput: StandupInputData) {
        return this.viewBuilder.createChatMessageEditDisclaimer(viewInput);
    }

    public buildScheduledMessageDelete(msgId: string, channelId: string, postAt: number, userId: string, timezone: string, args: ChatScheduleMessageArguments) : ChatPostEphemeralArguments {
        return this.viewBuilder.buildScheduledMessageDeleteMessage(msgId, channelId, postAt, userId, timezone, args);
    }

    public async deleteScheduledMessage(body: BlockAction, client: WebClient, logger: Logger) : Promise<ChatPostEphemeralArguments | string> {
        // console.log(JSON.stringify(body, null, 2));
        const button = body["actions"].find(i => i.action_id === "delete-msg-action");
        const msgVal = (button as ButtonAction).value;

        const cmd = DeleteCommand.buildFromString(msgVal);
        console.log(`Deleting message ${cmd?.messageId} for channel ${cmd?.channelId}`);
        if(cmd) {
            try {
                const result = await client.chat.deleteScheduledMessage(
                    {
                        channel: cmd.channelId,
                        scheduled_message_id: cmd.messageId,
                    }
                );
                if(result.ok) {
                    const msg = `Message ${cmd.messageId} deleted`;
                    return {
                        channel: body.channel?.id!,
                        text: msg,
                        mrkdwn: true,
                        unfurl_links: false,
                        unfurl_media: false,
                        user: body.user.id
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
                console.log(`Removing Standup Parking Lot Data ${cmd.channelId} ${cmd.postAt} ${cmd.userId}`);
                await this.dao.removeStandupParkingLotData(cmd.channelId, new Date(cmd.postAt), cmd.userId);
            }
        }
        return "Invalid delete command";
    }

    public buildErrorView(msg: string): ModalView {
        return this.viewBuilder.buildErrorView(msg);
    }

    public buildErrorMessage(input: StandupInputData, msg: string): ChatPostEphemeralArguments {
        return this.viewBuilder.buildErrorMessage(input, msg);
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