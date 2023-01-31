import {Block, ContextBlock, HeaderBlock, Logger, SectionBlock, SlashCommand, ViewOutput} from "@slack/bolt";
import {ChatPostMessageArguments, UsersInfoResponse, ViewsOpenArguments, WebClient} from "@slack/web-api";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";

export class SlackBot {

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
                        type: "input",
                        block_id : "yesterday",
                        element: {
                            type: "plain_text_input",
                            multiline: true,
                            action_id: "yesterday-action",
                            focus_on_load: true,
                        },
                        label: {
                            type: "plain_text",
                            text: "Yesterday",
                            emoji: true
                        }
                    },
                    {
                        type: "input",
                        block_id : "today",
                        element: {
                            type: "plain_text_input",
                            multiline: true,
                            action_id: "today-action"
                        },
                        label: {
                            type: "plain_text",
                            text: "Today",
                            emoji: true
                        }
                    },
                    {
                        type: "input",
                        block_id : "parking-lot",
                        optional : true,
                        element: {
                            type: "plain_text_input",
                            multiline: true,
                            action_id: "parking-lot-action"
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
                        block_id : "parking-lot-participants",
                        element: {
                            type: "multi_users_select",
                            placeholder: {
                                type: "plain_text",
                                text: "Select teammates",
                                emoji: true
                            },
                            action_id: "parking-lot-participants-action"
                        },
                        label: {
                            type: "plain_text",
                            text: "Parking Lot Participants",
                            emoji: true
                        }
                    }
                ],
                submit: {
                    type: 'plain_text',
                    text: 'Submit'
                }

            }
        };
    }

    /**
     * Get either the memberIds that were previously saved, or members of the channel
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

    public async createChatMessageFromViewOutput(view: ViewOutput, client: WebClient, logger: Logger): Promise<ChatPostMessageArguments> {
        // channel_id and maybe user_id stored from submit
        const pm = JSON.parse(view['private_metadata']) as PrivateMetadata;
        const channelId = pm.channelId!;
        const userId = pm.userId!;

        const userInfo = await this.queryUser(userId, client);

        const userInfoMsg = userInfo.user?.real_name!;

        // Yesterday
        const yesterday = view['state']['values']['yesterday']['yesterday-action'].value!;
        // Today
        const today = view['state']['values']['today']['today-action'].value!;
        // Parking Lot
        const parkingLot = view['state']['values']['parking-lot']['parking-lot-action'].value;

        // Parking Lot Attendees
        // Get list of selected members
        const selectedMemberIds = view['state']['values']['parking-lot-participants']['parking-lot-participants-action'];

        const blocks = await this.buildOutputBlocks(userInfoMsg, yesterday, today, parkingLot, selectedMemberIds.selected_users!, client, logger);
        // post as the user who requested
        return {
            channel: channelId,
            username: userInfo.user?.real_name,
            icon_url: userInfo.user?.profile?.image_72,
            blocks: blocks,
            text: userInfoMsg,
            mrkdwn: true
        };
    }

    public async createChatMessageEditDisclaimer(view: ViewOutput) : Promise<ChatPostEphemeralArguments> {
        const pm = JSON.parse(view['private_metadata']) as PrivateMetadata;
        const channelId = pm.channelId!;
        const userId = pm.userId!;

        const blocks = [];
        blocks.push(this.buildEditDisclaimerBlock());
        return {
            channel: channelId,
            user: userId,
            blocks: blocks,
        }

    }

    private async buildOutputBlocks(userInfoMsg: string,
                                    yesterday: string, today: string,
                              parkingLotItems: string | null | undefined,
                              parkingLotAttendees: string[],
                              client: WebClient,
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
        console.log(blocks);

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
                const memberInfos = await this.queryUsers(parkingLotAttendees, client);
                // Text output
                const memberOutput = this.formatMembersForOutput(memberInfos);
                const context: ContextBlock = {
                    type: "context",
                    elements: []
                };
                memberInfos.forEach(m => {
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

    private buildEditDisclaimerBlock() {
        return {
            type: "context",
            elements: [{
                type: "mrkdwn",
                text: "You cannot edit your standup post. Add any updates in its thread :thread:"
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
     * @private
     */
    private formatMembersForOutput(memberInfos: UsersInfoResponse[]): string {
        let formatted = "";
        memberInfos.forEach((m, index) => {
            formatted += "<@" + m.user?.id + "> ";

        });
        formatted += "\n";

        return formatted.toString();
    }
}