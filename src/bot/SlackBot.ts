import {Block, ContextBlock, HeaderBlock, Logger, SectionBlock, SlashCommand, ViewOutput} from "@slack/bolt";
import {ChatPostMessageArguments, UsersInfoResponse, ViewsOpenArguments, WebClient} from "@slack/web-api";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {StandupParkingLotDataDao} from "../data/StandupParkingLotDataDao";
import {StandupParkingLotData} from "../data/StandupParkingLotData";

export class SlackBot {

    private SHORTCUT_STORY_URL = "https://app.shortcut.com/homebound-team/story/";
    private dao: StandupParkingLotDataDao;

    private storySearchRegex = new RegExp(/`(\d{5})`/, "g");

    constructor(dao: StandupParkingLotDataDao) {
        this.dao = dao;
    }

    /**
     * Create the initial modal view. block_id and action_id are hardcoded.
     * @param body
     * @param client
     * @param logger
     */
    public async buildModalView(body: SlashCommand, client: WebClient, logger: Logger): Promise<ViewsOpenArguments> {
        const channelId = body.channel_id;

        // let memberIds = await this.loadMemberIdsForModal(channelId, logger, client, body);

        const pm: PrivateMetadata = {
            channelId: channelId,
            userId: body.user_id
        };

        return {
            trigger_id: body.trigger_id,
            // View payload
            view: {
                type: 'modal',
                // View identifier
                callback_id: 'standup_view',
                clear_on_close: true,
                // Save the channel ID and user ID for subsequent interactions
                private_metadata: JSON.stringify(pm),
                title: {
                    type: 'plain_text',
                    text: 'Async Standup Status'
                },
                blocks: [
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": "Five-digit numbers surrounded by backticks `` and displayed as `code` will be linked to Shortcut stories.",
                            }
                        ]
                    },
                    {
                        "type": "divider"
                    },
                    {
                        type: "input",
                        block_id: "yesterday",
                        element: {
                            type: "plain_text_input",
                            multiline: true,
                            action_id: "yesterday-action",
                            focus_on_load: true,
                            placeholder: {
                                type: "plain_text",
                                text: "What you did yesterday"
                            }
                        },
                        label: {
                            type: "plain_text",
                            text: "Yesterday",
                            emoji: true
                        }
                    },
                    {
                        type: "input",
                        block_id: "today",
                        element: {
                            type: "plain_text_input",
                            multiline: true,
                            action_id: "today-action",
                            placeholder: {
                                type: "plain_text",
                                text: "What you will do today"
                            }
                        },
                        label: {
                            type: "plain_text",
                            text: "Today",
                            emoji: true
                        }
                    },
                    {
                        type: "input",
                        block_id: "parking-lot",
                        optional: true,
                        element: {
                            type: "plain_text_input",
                            multiline: true,
                            action_id: "parking-lot-action",
                            placeholder: {
                                type: "plain_text",
                                text: "Parking Lot items to discuss"
                            }
                        },
                        label: {
                            type: "plain_text",
                            text: "Parking Lot Items",
                            emoji: true
                        }
                    },
                    {
                        type: "input",
                        optional: true,
                        block_id: "parking-lot-participants",
                        element: {
                            type: "multi_users_select",
                            placeholder: {
                                type: "plain_text",
                                text: "Select teammates",
                                emoji: true,
                            },
                            action_id: "parking-lot-participants-action"
                        },
                        label: {
                            type: "plain_text",
                            text: "Parking Lot Participants",
                            emoji: true
                        }
                    },
                    {
                        type: "input",
                        block_id: "pull-requests",
                        optional: true,
                        element: {
                            type: "plain_text_input",
                            multiline: true,
                            action_id: "pull-requests-action",
                            placeholder: {
                                type: "plain_text",
                                text: "PRs you need reviewed"
                            }
                        },
                        label: {
                            type: "plain_text",
                            text: "Pull Requests for Review",
                            emoji: true
                        }
                    },
                ],
                submit: {
                    type: 'plain_text',
                    text: 'Submit'
                }

            }
        };
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

    public async createAndHandleChatMessageFromViewOutput(view: ViewOutput, client: WebClient, logger: Logger): Promise<ChatPostMessageArguments> {
        // channel_id and maybe user_id stored from submit
        const pm = JSON.parse(view['private_metadata']) as PrivateMetadata;
        const channelId = pm.channelId!;
        const userId = pm.userId!;

        const userInfo = await this.queryUser(userId, client);

        const userInfoMsg = userInfo.user?.real_name!;

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

        const attendees = selectedMemberIds.selected_users!;
        let memberInfos: UsersInfoResponse[] = [];
        if (attendees.length > 0) {
            memberInfos = await this.queryUsers(attendees, client);
        }

        yesterday = this.formatTextNumbersToStories(yesterday);

        today = this.formatTextNumbersToStories(today);

        if(parkingLot)
        {
            parkingLot = this.formatTextNumbersToStories(parkingLot);
        }

        if(pullRequests)
        {
            pullRequests = this.formatTextNumbersToStories(pullRequests);
        }

        const blocks = await this.buildOutputBlocks(userInfoMsg, yesterday, today, parkingLot, pullRequests, memberInfos, logger);

        try {
            await this.saveParkingLotData(channelId, new Date(), userId, parkingLot, memberInfos);
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
            unfurl_media: false
        };
    }

    public async createChatMessageEditDisclaimer(view: ViewOutput): Promise<ChatPostEphemeralArguments> {
        const pm = JSON.parse(view['private_metadata']) as PrivateMetadata;
        const channelId = pm.channelId!;
        const userId = pm.userId!;

        const blocks = [];
        const msg = "You cannot edit your standup post. Add any updates in its thread :thread:"
        blocks.push(this.buildEditDisclaimerBlock(msg));
        return {
            channel: channelId,
            user: userId,
            blocks: blocks,
            text: msg
        }
    }

    public async buildParkingLotDisplayData(channelId: string, date: Date, client: WebClient): Promise<string> {
        let p: StandupParkingLotData | null = await this.dao.getChannelParkingLotDataForDate(channelId, date);
        if (p) {
            let proms = await p.parkingLotData!.map(async i => {
                let u = await this.queryUser(i.userId, client);
                let attendeeList = i.attendees!.map(a => {
                    return this.atMember(a);
                }).join(", ");
                return "*" + u.user?.real_name + "*\n" + i.content + "\n*Attendees*: " + attendeeList;
            }).flat();
            let out = await Promise.all(proms);
            return out.join("\n");
        }
        return "No parking lot items today";
    }

    public async saveParkingLotData(channelId: string,
                                    date: Date,
                                    userId: string,
                                    parkingLotItems: string | null | undefined,
                                    parkingLotAttendees: UsersInfoResponse[]) {
        if (parkingLotItems || parkingLotAttendees.length > 0) {
            let plNames: string[] = [];
            if (parkingLotAttendees.length > 0) {
                plNames = parkingLotAttendees.map((m) => {
                    return m.user?.id!
                });
            }
            // check if this object already exists
            let d = await this.dao.getChannelParkingLotDataForDate(channelId, date);
            if (d) {
                // updating, add or replace item for user
                let foundIndex = d.parkingLotData!.findIndex(p => {
                    return p.userId == userId;
                });
                if (foundIndex >= 0) {
                    d.parkingLotData![foundIndex] = {
                        userId: userId,
                        attendees: plNames,
                        content: parkingLotItems ? parkingLotItems : ""
                    }
                } else {
                    // push the new item onto the list
                    d.parkingLotData!.push({
                        userId: userId,
                        attendees: plNames,
                        content: parkingLotItems ? parkingLotItems : ""
                    });
                }

                await this.dao.updateStandupParkingLotData(d);
            } else {
                d = new StandupParkingLotData();
                d.standupDate = date;
                d.channelId = channelId;
                d.parkingLotData = [
                    {
                        content: parkingLotItems ? parkingLotItems : "",
                        userId: userId,
                        attendees: plNames
                    }
                ]
                await this.dao.putStandupParkingLotData(d);
            }
        }
    }

    private async buildOutputBlocks(userInfoMsg: string,
                                    yesterday: string, today: string,
                                    parkingLotItems: string | null | undefined,
                                    pullRequests: string | null | undefined,
                                    parkingLotAttendees: UsersInfoResponse[],
                                    logger: Logger) {
        const blocks: (Block | ContextBlock | HeaderBlock | SectionBlock)[] = [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: userInfoMsg + " :speaking_head_in_silhouette:",
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: ":rewind: *Yesterday*\n" + yesterday
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: ":arrow_forward: *Today*\n" + today
                }
            }
        ];

        if (pullRequests) {
            blocks.push(
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: ":computer: *Pull Requests for Review*\n" + pullRequests
                    }
                }
            );
        }

        if (parkingLotItems) {
            blocks.push(
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: ":car: *Parking Lot Items*\n" + parkingLotItems
                    }
                }
            );
        }
        if (parkingLotAttendees.length > 0) {
            try {
                // Text output
                const memberOutput = this.formatMembersForOutput(parkingLotAttendees, " ") + "\n";
                const context: ContextBlock = {
                    type: "context",
                    elements: []
                };
                parkingLotAttendees.forEach(m => {
                    context.elements.push(
                        {
                            type: "image",
                            image_url: m.user!.profile!.image_72!,
                            alt_text: m.user!.real_name!
                        }
                    );
                });

                blocks.push({
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: ":busts_in_silhouette: *Parking Lot Attendees*\n" + memberOutput
                        }
                    },
                    context
                );

            } catch (e) {
                logger.error(e);
            }
        }

        return blocks;
    }

    private buildEditDisclaimerBlock(msg: string) {
        return {
            type: "context",
            elements: [{
                type: "mrkdwn",
                text: msg
            }]
        };
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

    /**
     * Use each UsersInfoResponse to output an image and name
     * @param memberInfos
     * @param divider
     * @private
     */
    private formatMembersForOutput(memberInfos: UsersInfoResponse[], divider: string): string {
        let formatted = "";
        memberInfos.forEach((m, index) => {
            formatted += this.atMember(m.user?.id!) + divider;
        });

        return formatted.toString();
    }

    private atMember(id: string) {
        return "<@" + id + ">";
    }

    private formatTextNumbersToStories(content: string) {
        return content.replace(this.storySearchRegex, "<" + this.SHORTCUT_STORY_URL + "$1" + "|$1>");
    }

}