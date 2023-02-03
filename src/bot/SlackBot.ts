import {BlockAction, ButtonAction, Logger, SlashCommand, ViewOutput} from "@slack/bolt";
import {
    ChatDeleteScheduledMessageResponse,
    ChatPostMessageArguments,
    ChatScheduleMessageArguments,
    UsersInfoResponse,
    ViewsOpenArguments,
    WebClient
} from "@slack/web-api";
import {StandupParkingLotDataDao} from "../data/StandupParkingLotDataDao";
import {StandupParkingLotData} from "../data/StandupParkingLotData";
import {BotViewBuilder, DeleteCommand, ParkingLotDisplayItem} from "./BotViewBuilder";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";

export class StandupInputData {
    pm: PrivateMetadata
    yesterday: string
    today: string
    parkingLot?: string | null | undefined
    attendees: string[] = []
    pullRequests?: string | null | undefined
    scheduleDateTime?: number | null | undefined
}

export class SlackBot {
    private dao: StandupParkingLotDataDao;

    private viewBuilder = new BotViewBuilder();

    constructor(dao: StandupParkingLotDataDao) {
        this.dao = dao;
    }

    /**
     * Create the initial modal view. block_id and action_id are hardcoded.
     * @param body
     * @param logger
     */
    public buildModalView(body: SlashCommand, logger: Logger): ViewsOpenArguments {
        const channelId = body.channel_id;

        // let memberIds = await this.loadMemberIdsForModal(messageId, logger, client, body);

        const pm: PrivateMetadata = {
            channelId: channelId,
            userId: body.user_id
        };

        const trigger_id = body.trigger_id;

        return this.viewBuilder.buildModalInputView(trigger_id, pm);
    }

    /**
     * Get either the memberIds that are members of the channel
     * @param channelId
     * @param logger
     * @param client
     * @param body
     * @private
     */
    private async loadMemberIdsForModal(channelId: string, logger: Logger, client: WebClient, body: SlashCommand) {
        let memberIds = await this.getChannelMembers(client, body, logger);

        if (memberIds) {
            memberIds = await this.filterMembersListForRemoved(memberIds, client, logger);
        }
        return memberIds;
    }

    public getViewInputValues(view: ViewOutput): StandupInputData {
        const pm = JSON.parse(view['private_metadata']) as PrivateMetadata;

        // Yesterday
        let yesterday = view['state']['values']['yesterday']['yesterday-action'].value!;
        // Today
        let today = view['state']['values']['today']['today-action'].value!;
        // Parking Lot
        let parkingLot = view['state']['values']['parking-lot']['parking-lot-action'].value;

        // Parking Lot Attendees
        // Get list of selected members
        const selectedMemberIds = view['state']['values']['parking-lot-participants']['parking-lot-participants-action'];

        // Pull Requests
        let pullRequests = view['state']['values']['pull-requests']['pull-requests-action'].value;

        let dateStr = view['state']['values']['schedule-date']['schedule-date-action']['selected_date'];
        let timeStr = view['state']['values']['schedule-time']['schedule-time-action']['selected_time'];

        let dateTime: number;
        if(dateStr && timeStr) {
            dateTime = Date.parse(dateStr + "T" + timeStr + ":00");
        }
        const attendees = selectedMemberIds.selected_users!;

        return {
            pm: pm,
            yesterday: yesterday,
            today: today,
            parkingLot: parkingLot,
            attendees: attendees,
            pullRequests: pullRequests,
            scheduleDateTime: dateTime!,
        }
    }
    public async createChatMessageFromViewOutputAndSaveData(viewInput: StandupInputData, client: WebClient, logger: Logger): Promise<ChatPostMessageArguments | ChatScheduleMessageArguments> {
        // channel_id and maybe user_id stored from submit
        const channelId = viewInput.pm.channelId!;
        const userId = viewInput.pm.userId!;

        const userInfo = await this.queryUser(userId, client);

        const userInfoMsg = userInfo.user?.real_name!;

        let memberInfos: UsersInfoResponse[] = [];
        if (viewInput.attendees.length > 0) {
            memberInfos = await this.queryUsers(viewInput.attendees, client);
        }

        const blocks = this.viewBuilder.buildChatMessageOutputBlocks(userInfoMsg, viewInput.yesterday, viewInput.today, viewInput.parkingLot, viewInput.pullRequests, memberInfos, logger);

        try {
            await this.saveParkingLotData(channelId, new Date(), userId, viewInput.parkingLot, memberInfos);
        } catch (e) {
            logger.error(e);
        }

        // post as the user who requested
        return {
            channel: channelId,
            username: userInfo.user?.real_name,
            icon_url: userInfo.user?.profile?.image_72,
            blocks: blocks,
            text: userInfoMsg,
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
                item.userName = u.user?.real_name!;
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
                                    parkingLotAttendees: UsersInfoResponse[]) {
        const pla = parkingLotAttendees.map(u => {
            return u.user?.id!;
        })
        await this.dao.upsertStandupParkingLotData(channelId, date, userId, parkingLotItems, pla);
    }

    private async queryUsers(users: string[], client: WebClient) {
        const memberInfosProm = users?.map(m => {
            return this.queryUser(m, client);
        });

        return await Promise.all(memberInfosProm!);
    }

    private async queryUser(user: string, client: WebClient) {
        return client.users.info({
            user: user
        });
    }

    /**
     * Filter the members list against the full list of users and remove anyone who is not active
     * @param membersList
     * @param client
     * @param logger
     * @private
     */
    private async filterMembersListForRemoved(membersList: string[], client: WebClient, logger: Logger): Promise<string[]> {
        try {
            const members = await this.queryUsers(membersList, client);
            membersList = members.filter(m => {
                return !m.user?.deleted;
            }).map(u => {
                return u.user!.id!;
            });
        } catch (e) {
            logger.error(e);
        }
        return membersList;
    }

    /**
     * Get members of a channel, whose id is found in the body. Additionally, filter bots.
     * @param client
     * @param body
     * @param logger
     * @private
     */
    private async getChannelMembers(client: WebClient, body: SlashCommand, logger: Logger): Promise<string[] | undefined> {
        let memString;
        try {
            // get members of the channel
            const members = await client.conversations.members({
                channel: body.channel_id
            });

            memString = members.members;

            // filter bots
            const allMembers = await SlackBot.getAllMembers(client);

            if (allMembers) {
                const allBots = allMembers.filter(m => m.is_bot);
                if (allBots) {
                    const allBotIds = allBots.map(m => m.id)
                    if (allBots && memString) {
                        memString = memString.filter(m => !allBotIds.includes(m));
                    }
                }
            }
        } catch (e) {
            logger.error(e);
        }
        return memString;
    }

    /**
     * Get all members in a workspace.
     * @param client
     * @private
     */
    private static async getAllMembers(client: WebClient) {
        const allMembers = await client.users.list();
        return allMembers.members;
    }

    public createChatMessageEditDisclaimer(viewInput: StandupInputData) {
        return this.viewBuilder.createChatMessageEditDisclaimer(viewInput);
    }

    public buildScheduledMessageDelete(msgId: string, channelId: string, postAt: number, userId: string) : ChatPostEphemeralArguments {
        return this.viewBuilder.buildScheduledMessageDeleteMessage(msgId, channelId, postAt, userId);
    }

    public async deleteScheduledMessage(body: BlockAction, client: WebClient, logger: Logger) : Promise<string> {
        // console.log(JSON.stringify(body, null, 2));
        let button = body["actions"].find(i => i.action_id === "delete-msg-action");
        let msgVal = (button as ButtonAction).value;

        let cmd = DeleteCommand.buildFromString(msgVal);
        console.log(`Deleting message ${cmd?.messageId} for channel ${cmd?.channelId}`);
        if(cmd) {
            try {
                let result = await client.chat.deleteScheduledMessage(
                    {
                        channel: cmd.channelId,
                        scheduled_message_id: cmd.messageId,
                    }
                );
                return result.ok ? "Message deleted" : result.error!.toString();
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

}