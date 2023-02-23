import {KnownBlock, PlainTextInput, Timepicker, ViewsOpenArguments} from "@slack/web-api";
import {
    ActionsBlock,
    Block,
    Button,
    ContextBlock,
    Datepicker,
    HeaderBlock,
    HomeView,
    InputBlock,
    ModalView,
    MultiUsersSelect,
    SectionBlock
} from "@slack/bolt";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {ChangeMessageCommand} from "./Commands";
import {StandupViewData} from "../dto/StandupViewData";
import {UserInfo} from "../dto/UserInfo";
import {ACTION_NAMES} from "./ViewConstants";
import {PrivateMetadata} from "../dto/PrivateMetadata";
import {logger} from "../utils/appContext";
import {StandupStatus, StandupStatusType} from "../data/StandupStatus";
import {formatDateToPrintableWithTime, formatUtcDateToPrintable} from "../utils/datefunctions";

export class ParkingLotDisplayItem {
    userName: string
    content: string
    attendeeIds: string[]
}

export class BotViewBuilder {

    private SHORTCUT_STORY_URL = "https://app.shortcut.com/homebound-team/story/";
    /**
     * 12345 NO
     * SC-12345 NO
     * `sc-12345` YES
     * `SC-12345` YES
     * `12345` YES
     * @private
     */
    private storySearchRegex = new RegExp(/`((SC-)?(\d{5}))`/, "g");

    /**
     * Build the primary input view using block kit.
     *
     * @param trigger_id
     * @param pm
     * @param userInfo passed in to pre-populate the user's timezone for the timepicker
     * @param blockData
     */
    public buildModalInputView(trigger_id: string, pm: PrivateMetadata, userInfo: UserInfo, blockData?: StandupViewData): ViewsOpenArguments {
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
        // If this is a new or scheduled message, add the schedule date and time inputs
        // If it has been posted, we can't show these
        if (pm.messageType === "scheduled" || !pm.messageId) {
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

        if (blockData) {
            this.loadBlock(args, "yesterday", blockData.yesterday);
            this.loadBlock(args, "today", blockData.today);
            if (blockData.parkingLot) {
                this.loadBlock(args, "parking-lot", blockData.parkingLot);
            }
            if (blockData.attendees) {
                this.loadBlock(args, "parking-lot-participants", blockData.attendees);
            }
            if (blockData.pullRequests) {
                this.loadBlock(args, "pull-requests", blockData.pullRequests);
            }
            if (blockData.dateStr) {
                this.loadBlock(args, "schedule-date", blockData.dateStr);
            }
            if (blockData.timeStr) {
                this.loadBlock(args, "schedule-time", blockData.timeStr);
            }
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
        if (block as InputBlock) {
            switch ((block as InputBlock).element.type) {
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

    private findBlockById(viewArgs: ViewsOpenArguments, blockId: string): Block | undefined {
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

    private buildScheduledMessageEditAndDeleteBlocks(cmd: ChangeMessageCommand, msg: string): Block[] {
        const blocks: KnownBlock[] = [
            {
                type: "section",
                text: {
                    type: "plain_text",
                    text: msg
                },
            },
            this.buildChangeMessageActions(cmd.messageId, this.buildDeleteButton(cmd, ACTION_NAMES.get("DELETE_SCHEDULED_MESSAGE")!, "Delete Scheduled Status"), this.buildEditButton(cmd, ACTION_NAMES.get("EDIT_SCHEDULED_MESSAGE")!, "Edit Scheduled Status")),
            {
                type: "divider"
            }
        ];
        return blocks;
    }

    private buildChangeMessageActions(id: string, ...buttons: Button[]): ActionsBlock {
        return {
            type: "actions",
            block_id: "change-msg-" + id,
            elements: buttons
        };
    }

    private buildDeleteButton(cmd: ChangeMessageCommand, actionId: string, msg: string): Button {
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

    private buildEditButton(cmd: ChangeMessageCommand, actionId: string, msg: string): Button {
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
     * Create the output blocks to post in chat.
     *
     * @param messageType
     * @param userInfo Object that allows us access to user's image and name
     * @param yesterday
     * @param today
     * @param parkingLotItems
     * @param pullRequests
     * @param parkingLotAttendees UserInfo objects so we can get each user's image and name
     */
    public buildChatMessageOutputBlocks(messageType: StandupStatusType,
                                        userInfo: UserInfo,
                                        yesterday: string, today: string,
                                        parkingLotItems: string | null | undefined,
                                        pullRequests: string | null | undefined,
                                        parkingLotAttendees: UserInfo[]) {
        logger.debug("Building chat message output blocks for " + userInfo.name + " with message type " + messageType);
        const blocks: (Block | ContextBlock | HeaderBlock | SectionBlock)[] = []
        // This set of blocks can show up many times on the homepage, so do not give blocks IDs
        blocks.push({
            type: "header",
            text: {
                type: "plain_text",
                text: userInfo.name + " :speaking_head_in_silhouette:",
            }
        });
        // if this is a scheduled message, add the user's face
        if (messageType === "scheduled") {
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
        memberInfos.forEach((m) => {
            formatted += this.atMember(m.userId) + divider;
        });

        return formatted;
    }

    private atMember(id: string) {
        return "<@" + id + ">";
    }

    public buildSimpleContextBlock(msg: string): ContextBlock {
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
     * @param msg
     */
    public buildChatMessageEditBlocks(cmd: ChangeMessageCommand, msg: string): Block[] {
        const blocks: KnownBlock[] = [{
            type: "section",
            text: {
                type: "mrkdwn",
                text: "You may edit your status using the button below. Updates will overwrite the existing message."
            }
        }];

        blocks.push(this.buildChangeMessageActions(cmd.messageId, this.buildEditButton(cmd, ACTION_NAMES.get("EDIT_MESSAGE")!, msg)));
        return blocks;
    }

    /**
     * Create a string of parking lot items. When there are no parking lot attendees, the Attendees list will say "None".
     * @param pItems
     */
    public buildParkingLotDisplayItems(pItems: ParkingLotDisplayItem[]): string {
        if (pItems.length > 0) {
            let out = pItems.map(i => {
                // for each attendee, use their given id
                let attendeeList = i.attendeeIds!.map(a => {
                    return this.atMember(a);
                }).join(" ");
                return "*" + i.userName + "*\n" + this.formatTextNumbersToStories(i.content) + "\n*Attendees*: " + (attendeeList.length > 0 ? attendeeList : "None");
            }).flat();
            return out.join("\n");
        }
        return "No parking lot items today";
    }

    public formatTextNumbersToStories(content: string) {
        return content.replace(this.storySearchRegex, "<" + this.SHORTCUT_STORY_URL + "$3" + "|$1>");
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

    /**
     * Build the contents of the Home tab by querying for all messages for the current day, and beyond for the case of scheduled messages.
     * @param messages
     * @param userInfo
     * @param attendeeInfos
     * @param channelIdNameMap
     * @param today
     * @param tzOffset
     */
    buildHomeScreen(messages: StandupStatus[], userInfo: UserInfo, attendeeInfos: UserInfo[], channelIdNameMap: Map<string, string>, today: Date, tzOffset: number): HomeView {
        const blocks: KnownBlock[] = [];
        const view: HomeView = {
            type: "home",
            blocks: blocks,
        }
        blocks.push(
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: "Standup Statuses",
                }
            }
        );

        // Make a map out of the attendeeInfos for easy lookup
        const attendeeInfoMap = new Map(attendeeInfos.map(a => [a.userId, a]));
        try {
            let standupStatuses = messages.flatMap(m => {
                // for each message, build a section block. Do not do any timezone shift for standup date
                const mBlocks: (Block | ContextBlock | HeaderBlock | SectionBlock)[] = [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "*" + formatUtcDateToPrintable(m.standupDate.getTime()) + " - #" + channelIdNameMap.get(m.channelId) + "*"
                    }
                }];
                mBlocks.push(...m.statusMessages.flatMap(s => {
                    const sBlocks = [];
                    // for each status figure out which attendees are needed, and use filter to remove empty values
                    const attendees: UserInfo[] = s.parkingLotAttendees!.map(p => {
                       return attendeeInfoMap.get(p);
                    }).filter(Boolean) as UserInfo[];

                    sBlocks.push(...this.buildChatMessageOutputBlocks(s.messageType, userInfo, s.yesterday, s.today, s.parkingLot, s.pullRequests, attendees));
                    const cmd = new ChangeMessageCommand(s.messageId, s.channelId, s.userId, s.messageDate.getTime());
                    if (s.messageType === "posted") {
                        sBlocks.push(...this.buildChatMessageEditBlocks(cmd, "Edit Status"));
                    }
                    if (s.messageType === "scheduled") {
                        const dateStr = formatDateToPrintableWithTime(s.messageDate.getTime(), tzOffset);
                        const msg = "Status scheduled to send on " + dateStr;
                        sBlocks.push(...this.buildScheduledMessageEditAndDeleteBlocks(cmd, msg));
                    }
                    // add a divider after each message
                    sBlocks.push({
                        type: "divider"
                    });

                    return sBlocks;
                }));
                return mBlocks;
            });
            blocks.push(...standupStatuses as (KnownBlock)[]);
        } catch (e) {
            logger.error("Error building home screen", e);
        }


        return view;
    }
}