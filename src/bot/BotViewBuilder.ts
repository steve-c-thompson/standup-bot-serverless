import {ChatScheduleMessageArguments, UsersInfoResponse, ViewsOpenArguments} from "@slack/web-api";
import {Block, ContextBlock, HeaderBlock, Logger, ModalView, SectionBlock} from "@slack/bolt";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {StandupInputData, UserInfo} from "./SlackBot";

export class ParkingLotDisplayItem {
    userName: string
    content: string
    attendeeIds: string[]
}

export class DeleteCommand {
    channelId: string
    messageId: string
    postAt: number
    userId: string

    constructor(messageId: string, channelId: string, postAt: number, userId: string) {
        this.messageId = messageId;
        this.channelId = channelId;
        this.postAt = postAt;
        this.userId = userId;
    }

    public formatForTransfer(): string {
        return this.messageId + "#" + this.channelId + "#" + this.postAt + "#" + this.userId;
    }

    public static buildFromString(str: string) : DeleteCommand | null{
        let parts = str.split("#");
        if(parts.length != 4) {
            return null;
        }
        return new DeleteCommand(parts[0], parts[1], Number(parts[2]), parts[3]);
    }
}

export class BotViewBuilder {

    private SHORTCUT_STORY_URL = "https://app.shortcut.com/homebound-team/story/";
    private storySearchRegex = new RegExp(/`(\d{5})`/, "g");

    /**
     * Build the primary input view using block kit.
     *
     * @param trigger_id
     * @param pm
     */
    public buildModalInputView(trigger_id: string, pm: PrivateMetadata): ViewsOpenArguments {

        // const date = this.buildInitialScheduleDate();
        let args: ViewsOpenArguments = {
            trigger_id: trigger_id,
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
                        type: "context",
                        elements: [
                            {
                                type: "mrkdwn",
                                text: "Five-digit numbers surrounded by backticks `` and displayed as `code` will be linked to Shortcut stories.",
                            },
                        ]
                    },
                    {
                        type: "divider"
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
                    {
                        type: "input",
                        block_id: "schedule-date",
                        optional: true,
                        label: {
                            type: "plain_text",
                            text: "Optionally schedule this status."
                        },
                        element:
                            {
                                type: "datepicker",
                                action_id: "schedule-date-action"
                            },
                    },
                    {
                        type: "input",
                        block_id: "schedule-time",
                        optional: true,
                        element:
                            {
                                type: "timepicker",
                                action_id: "schedule-time-action"
                            },
                        label: {
                            type: "plain_text",
                            text: "Select a date and time"
                        }
                    },
                ],
                submit: {
                    type: 'plain_text',
                    text: 'Submit'
                }
            }
        };
        return args;
    }

    /**
     * Build a date for the schedule picker.
     * If it is after 5pm, day is tomorrow, otherwise assume today 9 am.
     * Edge cases of next month handled by Date
     * @private
     */
    private buildInitialScheduleDate(): Date {
        const d = new Date();
        if (d.getHours() >= 16) {
            d.setDate(d.getDate() + 1);
        }
        d.setHours(8, 0, 0, 0);
        return d;
    }

    /**
     * Build a message to post in chat. This message contains a button which delivers a payload that
     * an action handler can parse to determine which message to delete.
     *
     * @param msgId
     * @param channelId
     * @param postAt
     * @param userId
     * @param args
     */
    public buildScheduledMessageDeleteMessage(msgId: string, channelId: string, postAt: number, userId: string, args: ChatScheduleMessageArguments): ChatPostEphemeralArguments {
        let postDt = new Date(postAt);
        const msg = "Your status below is scheduled to send on\n "
            + postDt.toLocaleDateString()
            + " at " + postDt.toLocaleTimeString();

        const cmd = new DeleteCommand(msgId, channelId, postAt, userId);
        const body: ChatPostEphemeralArguments = {
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: msg
                    },
                },
                {
                    type: "actions",
                    block_id: "delete-msg",
                    elements: [
                        {
                            type: "button",
                            style: "danger",
                            text: {
                                type: "plain_text",
                                text: "Delete Scheduled Status"
                            },
                            action_id: "delete-msg-action",
                            value: cmd.formatForTransfer(),
                            confirm: {
                                text: {
                                    type: "plain_text",
                                    text: "Are you sure you want to delete this status?"
                                }
                            }
                        }

                    ]
                },
                {
                    type: "divider"
                }
            ],
            channel: channelId,
            user: userId,
            text: msg
        }
        // Now add the message contents
        body.blocks!.push(...args.blocks!);
        body.blocks!.push(
            {
                type: "divider"
            });
        return body;
    }

    /**
     * Create the output to post in chat.
     * @param userInfo
     * @param yesterday
     * @param today
     * @param parkingLotItems
     * @param pullRequests
     * @param parkingLotAttendees
     * @param logger
     */
    public buildChatMessageOutputBlocks(userInfo: UserInfo,
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
                    text: userInfo.name + " :speaking_head_in_silhouette:",
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: ":rewind: *Yesterday*\n" + this.formatTextNumbersToStories(yesterday)
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: ":arrow_forward: *Today*\n" + this.formatTextNumbersToStories(today)
                }
            }
        ];

        if (pullRequests) {
            blocks.push(
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: ":computer: *Pull Requests for Review*\n" + this.formatTextNumbersToStories(pullRequests)
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
                        text: ":car: *Parking Lot Items*\n" + this.formatTextNumbersToStories(parkingLotItems)
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

    private buildEditDisclaimerBlock(msg: string) {
        return {
            type: "context",
            elements: [{
                type: "mrkdwn",
                text: msg
            }]
        };
    }

    public createChatMessageEditDisclaimer(viewInput: StandupInputData): ChatPostEphemeralArguments {
        const channelId = viewInput.pm.channelId!;
        const userId = viewInput.pm.userId!;

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

    public buildParkingLotDisplayItems(pItems: ParkingLotDisplayItem[]): string {
        if (pItems.length > 0) {
            let out = pItems.map(i => {
                // for each attendee, use their given id
                let attendeeList = i.attendeeIds!.map(a => {
                    return this.atMember(a);
                }).join(", ");
                return "*" + i.userName + "*\n" + this.formatTextNumbersToStories(i.content) + "\n*Attendees*: " + attendeeList;
            }).flat();
            return out.join("\n");
        }
        return "No parking lot items today";
    }

    public formatTextNumbersToStories(content: string) {
        return content.replace(this.storySearchRegex, "<" + this.SHORTCUT_STORY_URL + "$1" + "|$1>");
    }

    public buildErrorView(msg: string): ModalView {
        const viewArgs: ModalView = {
            type: 'modal',
            callback_id: 'standup_view',
            title: {
                type: 'plain_text',
                text: 'Standup Error'
            },
            close: {
                type: "plain_text",
                text: "Close",
            },
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: msg
                    }
                }
            ]
        }
        return viewArgs;
    }
}