import {ChatScheduleMessageArguments, KnownBlock, PlainTextInput, Timepicker, ViewsOpenArguments} from "@slack/web-api";
import {
    ActionsBlock,
    Block,
    Button,
    ContextBlock, Datepicker,
    HeaderBlock,
    InputBlock,
    Logger,
    ModalView, MultiUsersSelect,
    SectionBlock
} from "@slack/bolt";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {ChatMessageType} from "./SlackBot";
import {formatDateToPrintable} from "../utils/datefunctions";
import {ChangeScheduledMessageCommand, MessageCommand} from "./Commands";
import {StandupViewData} from "../dto/StandupViewData";
import {UserInfo} from "../dto/UserInfo";
import {ACTION_NAMES} from "./ViewConstants";

export class ParkingLotDisplayItem {
    userName: string
    content: string
    attendeeIds: string[]
}

export class BotViewBuilder {

    private SHORTCUT_STORY_URL = "https://app.shortcut.com/homebound-team/story/";
    private storySearchRegex = new RegExp(/`(\d{5})`/, "g");

    /**
     * Build the primary input view using block kit.
     *
     * @param messageType
     * @param trigger_id
     * @param pm
     * @param userInfo
     * @param blockData
     */
    public buildModalInputView(messageType: ChatMessageType, trigger_id: string, pm: PrivateMetadata, userInfo: UserInfo, blockData?: StandupViewData): ViewsOpenArguments {
        // const date = this.buildInitialScheduleDate();
        let args: ViewsOpenArguments = {
            trigger_id: trigger_id,
            // View payload
            view: {
                type: 'modal',
                // View identifier
                callback_id: 'standup_view',
                clear_on_close: true,
                // Save the channel ID, user ID, and maybe message id (ts) for subsequent interactions
                private_metadata: JSON.stringify(pm, null, 2),
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
                            action_id: ACTION_NAMES.get("YESTERDAY"),
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
                            action_id: ACTION_NAMES.get("TODAY"),
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
                            action_id: ACTION_NAMES.get("PARKING_LOT"),
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
                            action_id: ACTION_NAMES.get("PARTICIPANTS"),
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
                            action_id: ACTION_NAMES.get("PULL_REQUESTS"),
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
        // If this is a post message, add the option to schedule it
        if(messageType === "post") {
            args.view.blocks.push({
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
                            action_id: ACTION_NAMES.get("SCHEDULE_DATE"),
                        },
                },
                {
                    type: "input",
                    block_id: "schedule-time",
                    optional: true,
                    element:
                        {
                            type: "timepicker",
                            action_id: ACTION_NAMES.get("SCHEDULE_TIME"),
                            timezone: userInfo.timezone
                        },
                    label: {
                        type: "plain_text",
                        text: "Select a date and time"
                    }
                },);
        }

        if(blockData) {
            this.loadBlock(args, "yesterday", blockData.yesterday);
            this.loadBlock(args, "today", blockData.today);
            if(blockData.parkingLot){
                this.loadBlock(args, "parking-lot", blockData.parkingLot);
            }
            if(blockData.attendees){
                this.loadBlock(args, "parking-lot-participants", blockData.attendees);
            }
            if(blockData.pullRequests){
                this.loadBlock(args, "pull-requests", blockData.pullRequests);
            }
            // Don't worry about schedule dates, this cannot be scheduled
        }

        return args;
    }

    /**
     * Depending on the block type, set its initial value
     * @param viewArgs
     * @param blockId
     * @param blockValue
     * @private
     */
    private loadBlock(viewArgs: ViewsOpenArguments, blockId: string, blockValue: string | string[]) {
        const block: Block | undefined = this.findBlockById(viewArgs, blockId);
        if(block as InputBlock) {
            switch((block as InputBlock).element.type) {
                case "plain_text_input":
                    ((block as InputBlock).element as PlainTextInput).initial_value = blockValue as string;
                    break;
                case "multi_users_select":
                    ((block as InputBlock).element as MultiUsersSelect).initial_users = blockValue as string[];
                    break;
                case "datepicker":
                    ((block as InputBlock).element as Datepicker).initial_date = blockValue as string;
                    break;
                case "timepicker":
                    ((block as InputBlock).element as Timepicker).initial_time = blockValue as string;
                    break;
            }
        }
    }

    private findBlockById(viewArgs: ViewsOpenArguments, blockId: string): Block | undefined{
        return viewArgs.view.blocks.find(b => b.block_id === blockId);
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
     * Build a message to post in chat. This message contains buttons which deliver payloads that
     * an action handler can parse to determine which message to delete or edit.
     *
     * @param cmd
     * @param timezone`
     * @param args
     */
    public buildScheduledMessageDialog(cmd: ChangeScheduledMessageCommand, timezone: string, args: ChatScheduleMessageArguments): ChatPostEphemeralArguments {
        const dateStr = formatDateToPrintable(cmd.postAt, timezone);
        const msg = "Your status below is scheduled to send on\n " + dateStr;

        const body: ChatPostEphemeralArguments = {
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: msg
                    },
                },
                this.buildChangeMessageActions(this.buildDeleteButton(cmd, ACTION_NAMES.get("DELETE_SCHEDULED_MESSAGE")!, "Delete Scheduled Status"), this.buildEditButton(cmd, ACTION_NAMES.get("EDIT_SCHEDULED_MESSAGE")!,"Edit Scheduled Status")),
                {
                    type: "divider"
                }
            ],
            channel: cmd.channelId,
            user: cmd.userId,
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

    private buildChangeMessageActions(...buttons : Button[]): ActionsBlock {
        return {
            type: "actions",
            block_id: "change-msg",
            elements: buttons
        };
    }

    private buildDeleteButton(cmd: MessageCommand, actionId:string, msg: string): Button{
        return {
            type: "button",
            style: "danger",
            text: {
                type: "plain_text",
                text: msg
            },
            action_id: actionId,
            value: cmd.formatForTransfer(),
            confirm: {
                text: {
                    type: "plain_text",
                    text: "Are you sure you want to delete this status?"
                }
            }
        };
    }

    private buildEditButton(cmd: MessageCommand, actionId: string, msg: string): Button {
        return {
            type: "button",
            text: {
                type: "plain_text",
                text: msg
            },
            action_id: actionId,
            value: cmd.formatForTransfer(),
        };
    }

    /**
     * Create the output to post in chat.
     * @param: messageType
     * @param messageType
     * @param userInfo
     * @param yesterday
     * @param today
     * @param parkingLotItems
     * @param pullRequests
     * @param parkingLotAttendees
     * @param logger
     */
    public buildChatMessageOutputBlocks(messageType: ChatMessageType,
                                        userInfo: UserInfo,
                                        yesterday: string, today: string,
                                        parkingLotItems: string | null | undefined,
                                        pullRequests: string | null | undefined,
                                        parkingLotAttendees: UserInfo[],
                                        logger: Logger) {
        const blocks: (Block | ContextBlock | HeaderBlock | SectionBlock)[] = []
        blocks.push  ({
                type: "header",
                block_id: "header-block",
                text: {
                    type: "plain_text",
                    text: userInfo.name + " :speaking_head_in_silhouette:",
                }
            });
        // if this is a scheduled message, add the user's face
        if(messageType === "scheduled") {
            blocks.push({
               type: "context",
               elements: [
                   {
                       type: "image",
                       image_url: userInfo.img!,
                       alt_text: userInfo.name
                   }
               ]
            });
        }
        blocks.push(
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
        );

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
                            image_url: m.img!,
                            alt_text: m.name
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
    private formatMembersForOutput(memberInfos: UserInfo[], divider: string): string {
        let formatted = "";
        memberInfos.forEach((m, index) => {
            formatted += this.atMember(m.userId) + divider;
        });

        return formatted.toString();
    }

    private atMember(id: string) {
        return "<@" + id + ">";
    }

    public buildSimpleContextBlock(msg: string)   {
        return {
            type: "context",
            elements: [{
                type: "mrkdwn",
                text: msg
            }]
        };
    }

    /**
     * Create an ephemeral message containing an Edit button
     * @param cmd
     */
    public buildChatMessageEditDialog(cmd: MessageCommand): ChatPostEphemeralArguments {
        const channelId = cmd.channelId;
        const userId = cmd.userId;

        const blocks: KnownBlock[] = [{
            type: "section",
            text: {
                type: "mrkdwn",
                text: "You may edit your status"
            }
        }];
        const msg = "Edit status"

        blocks.push(this.buildChangeMessageActions(this.buildEditButton(cmd, ACTION_NAMES.get("EDIT_MESSAGE")!,"Edit Status")));
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

    /**
     * Build an error view around the message, with an X and title.
     * @param msg
     */
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

    /**
     * Build a full ephemeral message to post in the `channelId` and `userId` found on input
     * @param channelId
     * @param userId
     * @param msg
     */
    public buildErrorMessage(channelId: string, userId: string, msg: string): ChatPostEphemeralArguments {
        return {
            channel: channelId,
            user: userId,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: msg
                    }
                }
            ],
            text: msg
        };
    }
}