import {Logger, Option, SlashCommand, ViewOutput} from "@slack/bolt";
import {ChatPostMessageArguments, UsersInfoResponse, ViewsOpenArguments, WebClient} from "@slack/web-api";
import {promptsList} from "./PromptsList";

export class SlackBot {
    readonly MESSAGE_TITLE_DEFAULT = "Randomly selected members";

    /**
     * Create the initial modal view. block_id and action_id are hardcoded.
     * @param body
     * @param client
     * @param logger
     */
    public async openModalView(body: SlashCommand, client: WebClient, logger: Logger): Promise<ViewsOpenArguments> {
        const channelId = body.channel_id;

        let memberIds = await this.loadMemberIdsForModal(channelId, logger, client, body);

        let title = body.text ? body.text : "";

        const checkboxOption: Option = {
            text: {
                text: 'Number user list \n `1. User 1` \n `2. User 2`',
                type: 'mrkdwn',

            },
            value: 'yes',
        };

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
                callback_id: 'view_1',
                clear_on_close: true,
                // Save the channel ID and user ID for subsequent interactions
                private_metadata: JSON.stringify(pm),
                title: {
                    type: 'plain_text',
                    text: 'Rando'
                },
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: 'Select team members to randomize. This will output a list in the channel. You can choose to `@` members.'
                        }
                    },
                    {
                        type: 'input',
                        optional: true,
                        label: {
                            type: 'plain_text',
                            text: 'Prompt to precede the title'
                        },
                        block_id: 'prompt_select',
                        element: {
                            type: 'static_select',
                            action_id: 'prompt_select_val',
                            placeholder: {
                                type: 'plain_text',
                                text: 'Optionally select a common prompt'
                            },
                            options: [
                                {
                                    text: {
                                        text: promptsList.get('0')!.displayText,
                                        type: 'plain_text'
                                    },
                                    value: '0'
                                },
                                {
                                    text: {
                                        text: promptsList.get('1')!.displayText,
                                        type: 'plain_text'
                                    },
                                    value: '1'
                                }

                            ]
                        },
                    },
                    {
                        type: 'input',
                        block_id: 'title',
                        optional: true,
                        label: {
                            type: 'plain_text',
                            text: 'Title'
                        },
                        element: {
                            type: 'plain_text_input',
                            action_id: 'title_value',
                            initial_value: title,
                            focus_on_load: true
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'team_members',
                        label: {
                            type: 'plain_text',
                            text: 'Select Team Members'
                        },
                        element: {
                            action_id: 'member_list',
                            type: 'multi_users_select',
                            initial_users: memberIds,
                            placeholder: {
                                type: 'plain_text',
                                text: 'Select Teammates'
                            }
                        },
                    },
                    {
                        type: 'input',
                        dispatch_action: false,
                        optional: true,
                        label: {
                            type: 'plain_text',
                            text: 'Message Formatting'
                        },
                        block_id: 'order_list',
                        element: {
                            type: 'checkboxes',
                            action_id: 'order_list_val',
                            options: [
                                checkboxOption
                            ],
                            initial_options: [
                                checkboxOption
                            ]

                        },
                    },
                    {
                        type: 'input',
                        optional: true,
                        label: {
                            type: 'plain_text',
                            text: 'Number of users to notify'
                        },
                        block_id: 'at_users',
                        element: {
                            type: 'static_select',
                            action_id: 'at_users_val',
                            placeholder: {
                                type: 'plain_text',
                                text: 'Optionally select a number'
                            },
                            options: [
                                {
                                    text: {
                                        text: '1',
                                        type: 'plain_text'
                                    },
                                    value: '1'
                                },
                                {
                                    text: {
                                        text: '2',
                                        type: 'plain_text'
                                    },
                                    value: '2'
                                },
                                {
                                    text: {
                                        text: '3',
                                        type: 'plain_text'
                                    },
                                    value: '3'
                                },
                                {
                                    text: {
                                        text: 'All',
                                        type: 'plain_text'
                                    },
                                    value: 'all'
                                }
                            ]
                        },
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
        const prompt = view['state']['values']['prompt_select']['prompt_select_val'].selected_option?.value;
        let titleVal = view['state']['values']['title']['title_value'].value;

        let title = '';
        if (prompt) {
            title += promptsList.get(prompt)!.messageText;
        }
        if (titleVal) {
            title += titleVal;
        } else if (!prompt) {
            // if there is no titleVal or prompt, output default
            title = this.MESSAGE_TITLE_DEFAULT;
        }
        // channel_id and maybe user_id stored from submit
        let pm = JSON.parse(view['private_metadata']) as PrivateMetadata;
        const channelId = pm.channelId!;
        const userId = pm.userId;

        const orderListVal = view['state']['values']['order_list']['order_list_val'].selected_options?.length;

        const numToAtVal = view['state']['values']['at_users']['at_users_val'].selected_option?.value;

        const numToAt: number = numToAtVal == "all" ? 999 :
            !numToAtVal ? 0 : parseInt(numToAtVal!);

        // Get list of selected members
        let selectedMemberIds = view['state']['values']['team_members']['member_list'];
        let memberOutput = "";

        try {
            const memberInfos = await this.querySelectedMembers(selectedMemberIds.selected_users!, client);

            memberOutput = this.formatMembersForOutput(memberInfos, !!orderListVal, numToAt);
        } catch (e) {
            logger.error(e);
        }

        let msg = title + '\n' + memberOutput;
        return {channel: channelId, text: msg, mrkdwn: true};
    }

    private async querySelectedMembers(selectedMemberIds: string[], client: WebClient) {
        const memberInfosProm = selectedMemberIds?.map(m => {
            return client.users.info({
                user: m
            });
        });

        return await Promise.all(memberInfosProm!);
    }

    /**
     * Filter the members list against the full list of users and remove anyone who is not active
     * @param membersList
     * @private
     */
    private async filterMembersListForRemoved(membersList: string[], client: WebClient, logger: Logger): Promise<string[]> {
        try {
            let members = await this.querySelectedMembers(membersList, client);
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
            let members;
            members = await client.conversations.members({
                channel: body.channel_id
            });

            memString = members.members;

            // filter bots
            let allMembers = await SlackBot.getAllMembers(client);

            if (allMembers) {
                let allBots = allMembers.filter(m => m.is_bot);
                if (allBots) {
                    let allBotIds = allBots.map(m => m.id)
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
        let allMembers = await client.users.list();
        return allMembers.members;
    }

    /**
     *
     * @param memberInfos
     * @param numberListItems true if we number the list
     * @param numToAt the number of users to @
     * @private
     */
    private formatMembersForOutput(memberInfos: UsersInfoResponse[], numberListItems: boolean, numToAt = 0): string {
        let formatted = "";
        memberInfos.forEach((m, index) => {
            if (numberListItems) {
                formatted += (index + 1) + ". ";
            }
            if (index < numToAt) {
                formatted += "<@" + m.user?.id + ">";
            } else {
                formatted += m.user?.real_name
            }
            formatted += "\n";
        });

        return formatted.toString();
    }
}