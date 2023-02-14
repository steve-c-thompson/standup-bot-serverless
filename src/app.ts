import {App, AwsLambdaReceiver, BlockAction, ButtonAction, LogLevel} from '@slack/bolt';
import {AwsSecretsDataSource} from "./secrets/AwsSecretsDataSource";
import {context, logger} from "./utils/context";
import {APIGatewayProxyEvent} from "aws-lambda";
import {SlackBot} from "./bot/SlackBot";
import {ChatScheduleMessageArguments, ChatUpdateArguments} from "@slack/web-api";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {formatDateToPrintable} from "./utils/datefunctions";
import {ChangeMessageCommand} from "./bot/Commands";
import {ACTION_NAMES} from "./bot/ViewConstants";
import {DynamoDbStandupStatusDao} from "./data/DynamoDbStandupStatusDao";

let app: App;
const dataSource = new AwsSecretsDataSource(context.secretsManager);

let awsLambdaReceiver: AwsLambdaReceiver;

const logLevel = LogLevel.INFO;

/**
 * This is a slack bot that allows users to enter their standup status.
 *
 * This uses the @slack/bolt framework to handle the slack events and interactions.
 * https://slack.dev/bolt-js/tutorial/getting-started
 *
 * See the README for how to configure the bot
 */
const init = async () => {
    logger.debug("Executing async init");
    const signingSecret = await dataSource.slackSigningSecret();
    const slackBotToken = await dataSource.slackToken();

    const statusDao = new DynamoDbStandupStatusDao(context.dynamoDbClient);
    const slackBot: SlackBot = new SlackBot(statusDao);

    // Receiver provided by the @slack/bolt framework
    awsLambdaReceiver = new AwsLambdaReceiver({
        signingSecret: signingSecret,
        logLevel: logLevel
    });
    app = new App({
        token: slackBotToken,
        receiver: awsLambdaReceiver,
        logLevel: logLevel
    });

    /**
     * Handle the /standup command. This launches the modal view.
     *
     * Note: ideally we would check if the bot is in the channel, but that is not possible with the current slack api.
     */
    app.command("/standup", async ({ack, body, client, logger}) => {
        await ack();

        let args = body.text;

        if (args == "help") {
            let message = "How to use /standup"
            let attachments = [];
            attachments.push({
                "text": "`/standup` and enter your status in the modal"
                    + "\n`/standup [parking-lot | parking_lot | parkinglot | -p]` to display items in the parking lot (visible only to you)"
                    + "\n`/standup post [parking-lot | parking_lot | parkinglot | -p]` to post parking lot items to channel"

            });
            await client.chat.postEphemeral({
                text: message,
                attachments: attachments,
                channel: body.channel_id,
                user: body.user_id
            });
        } else if (args == "parking-lot" || args == "parking_lot" || args == "parkinglot" || args =="-p") {
            const userTzOffset = await slackBot.getUserTimezoneOffset(body.user_id, client);
            const parkingLotMsg = await slackBot.buildParkingLotDisplayData(body.channel_id, new Date(), userTzOffset, client );
            await client.chat.postEphemeral({
                text: ":car: *Parking Lot*\n" + parkingLotMsg,
                channel: body.channel_id,
                user: body.user_id
            })
        }
        else if (args == "post parking-lot" || args == "post parking_lot" || args == "post parkinglot" || args == "post -p") {
            const userTzOffset = await slackBot.getUserTimezoneOffset(body.user_id, client);
            const parkingLotMsg = await slackBot.buildParkingLotDisplayData(body.channel_id, new Date(), userTzOffset, client);
            await client.chat.postMessage({
                text: ":car: *Parking Lot*\n" + parkingLotMsg,
                channel: body.channel_id,
                user: body.user_id,
            })
        }
        else {
            try {
                let payload = await slackBot.buildNewMessageModalView(body, client);
                const result = await client.views.open(
                    payload
                );
                logger.debug(result);
            } catch (error) {
                logger.error(error);
            }
        }
    });

    /**
     * Main handler for view submissions. It first checks if the bot is in the channel, returning an error if not. It
     * then acknowledges the request.
     *
     * Much of the functionality relies on `PrivateMetaData.messageType` to determine what output to create,
     * as well as data received in the submission. Data is crucial because it identifies the message to update or delete.
     *
     * If a messageId comes in from the metadata, assume this is a status we must update (posted) or delete and update (scheduled).
     *
     * If there is no messageId, create new statuses.
     *
     * A scheduled status may be edited or deleted; both actions delete the scheduled message. The message can then be
     * rescheduled or posted directly to the channel.
     */
    app.view("standup_view", async ({ack, body, view, client, logger}) => {
        logger.debug("Handling standup-view submit");
        const viewInput = slackBot.getViewInputValues(view);
        // Check if the bot is in channel. If not, update view with error
        if(! await slackBot.validateBotUserInChannel(viewInput.pm.channelId!, body.view.bot_id, client)){
            logger.error("Standup bot is not a member of channel " + viewInput.pm.channelId);
            const msg = ":x: Standup is not a member of this channel. Please try again after adding it. Add through *Integrations* or by mentioning it, like " +
                    "`@Standup`."
            const viewArgs = slackBot.buildErrorView(msg);
            // logger.info(viewArgs);
            await ack({
                    response_action: "update",
                    view: viewArgs
                }
            );
            return;
        }
        await ack();
        try {
            // When a messageId is present we are editing a message
            const isEdit: boolean = !!viewInput.pm.messageId;
            const channelId = viewInput.pm.channelId!;
            const userId = viewInput.pm.userId!;

            // If the message type is scheduled but there is no scheduleDateTime, this message
            // must be deleted and posted to channel
            if(viewInput.pm.messageType === "scheduled" && isEdit) {
                // If this is an edit schedule message, delete the existing one
                 let command = new ChangeMessageCommand(viewInput.pm.messageId!,
                        viewInput.pm.messageDate!);
                 const result = await slackBot.deleteScheduledMessage(command, channelId, userId, client, logger);
                 // Post the result as an ephemeral message.
                 await client.chat.postEphemeral(result as ChatPostEphemeralArguments);
            }
            // If we have a scheduleDateTime, schedule a new message
            if(viewInput.scheduleDateTime) {
                // Schedule a new message
                let scheduleStr = formatDateToPrintable(viewInput.scheduleDateTime, viewInput.timezone!);

                const chatMessageArgs = await slackBot.createChatMessage(viewInput, client);
                logger.info("Scheduling message for " + scheduleStr + " with input " + viewInput.scheduleDateTime);
                // Unix timestamp is seconds since epoch
                chatMessageArgs.post_at = viewInput.scheduleDateTime / 1000;
                let scheduleResponse = await client.chat.scheduleMessage(chatMessageArgs as ChatScheduleMessageArguments);
                try {
                    const saveDate = new Date(viewInput.scheduleDateTime);
                    viewInput.pm.messageId = scheduleResponse.scheduled_message_id!;
                    viewInput.pm.messageDate = saveDate.getTime();
                    // timezone is assumed present with scheduleDateTime
                    await slackBot.saveStatusData(viewInput, saveDate, "scheduled", viewInput.timezone!);
                } catch (e) {
                    logger.error(e);
                }

                const date = new Date(scheduleResponse.post_at! * 1000);
                // @ts-ignore
                logger.info(`Message id ${scheduleResponse.scheduled_message_id} scheduled to send ${formatDateToPrintable(date.getTime(), viewInput.timezone)} for channel ${scheduleResponse.channel} `);

                // Use the response to create a dialog
                const msgId = scheduleResponse.scheduled_message_id!;
                const respChannelId = scheduleResponse.channel!;
                // Response userID is bot ID, get this data from PrivateMetadata
                let command = new ChangeMessageCommand(msgId,
                    viewInput.scheduleDateTime);
                command.messageId = msgId;
                let confMessage = slackBot.buildScheduledMessageDialog(command, respChannelId, userId,
                    viewInput.timezone!,
                    chatMessageArgs as ChatScheduleMessageArguments);

                await client.chat.postEphemeral(confMessage);
            }
            // No scheduleDateTime means we are not scheduling anything and must interact with the chat
            else {
                if(isEdit && viewInput.pm.messageType === "edit") {
                    // We are editing a posted message, so update using slack's API
                    const chatMessageArgs = await slackBot.createChatMessage(viewInput, client) as ChatUpdateArguments;
                    // Update the message using the API
                    const result = await client.chat.update(chatMessageArgs);
                    try {
                        const saveDate = new Date(viewInput.pm.messageDate!);
                        // set the timezone for saving
                        const tz = await slackBot.getUserTimezoneOffset(userId, client);
                        await slackBot.saveStatusData(viewInput, saveDate, "scheduled", tz);
                    } catch (e) {
                        logger.error("Error editing posted message ", e);
                    }
                    // Print the result of the attempt
                    if(result.ok){
                        logger.info(`Message ${result.ts} updated`);
                        const msg = await slackBot.buildEphemeralContextMessage(result.channel!, userId, "Your status was updated");
                        await client.chat.postEphemeral(msg);
                    }
                    else {
                        const msg = await slackBot.buildEphemeralContextMessage(channelId, userId, result.error!);
                        await client.chat.postEphemeral(msg);
                    }
                }
                // Not editing an existing posted message, but does one exist
                else {
                    viewInput.pm.messageType = "post";
                    const chatMessageArgs = await slackBot.createChatMessage(viewInput, client);
                    const result = await client.chat.postMessage(chatMessageArgs);
                    const standupDate = new Date();
                    viewInput.pm.messageId = result.ts!;
                    viewInput.pm.messageDate = standupDate.getTime();
                    const tz = await slackBot.getUserTimezone(userId, client);
                    try {
                        await slackBot.saveStatusData(viewInput, standupDate, "posted", tz);
                    } catch (e) {
                        logger.error(e);
                    }
                    const cmd = new ChangeMessageCommand(result.message?.ts!, standupDate.getTime());
                    const edit = slackBot.buildChatMessageEditDialog(cmd, result.channel!, userId);
                    await client.chat.postEphemeral(edit);
                }
            }
        } catch (error) {
            logger.error(error);
            let msg = (error as Error).message;
            const viewArgs = slackBot.buildErrorMessage(viewInput.pm.channelId!, viewInput.pm.userId!, msg);
            try {
                logger.info(viewArgs);
                await client.chat.postEphemeral(viewArgs);
            } catch (e) {
                logger.error("Secondary error", e);
            }
        }
    });

    /**
     * Handle the action of a button press from the change-msg block in the posted message.
     */
    app.action({block_id: "change-msg"}, async ({body,  ack, logger, client }) => {
        try {
            await ack();
            const action = (body as BlockAction)["actions"][0];
            let result;
            let cmd, triggerId;
            const msgVal = (action as ButtonAction).value;
            const userId = (body as BlockAction).user.id;
            const channelId = (body as BlockAction).channel?.id!;
            switch (action.action_id) {
                case ACTION_NAMES.get("DELETE_SCHEDULED_MESSAGE"):
                    cmd = ChangeMessageCommand.buildFromString(msgVal);
                    result = await slackBot.deleteScheduledMessage(cmd!, channelId, userId, client, logger);
                    await client.chat.postEphemeral(result as ChatPostEphemeralArguments);
                    break;
                case ACTION_NAMES.get("EDIT_SCHEDULED_MESSAGE"):
                    logger.info("Edit Request for scheduled message " + msgVal);
                    cmd = ChangeMessageCommand.buildFromString(msgVal);
                    triggerId = (body as BlockAction).trigger_id;
                    result = await slackBot.buildModalViewForScheduleUpdate(cmd!, channelId, userId, triggerId, client);
                    await client.views.open(result);
                    break;
                case ACTION_NAMES.get("EDIT_MESSAGE"):
                    logger.info("Edit Request for posted message " + msgVal);
                    cmd = ChangeMessageCommand.buildFromString(msgVal);
                    triggerId = (body as BlockAction).trigger_id;
                    result = await slackBot.buildModalViewForPostUpdate(cmd!, channelId, userId, triggerId, client);
                    await client.views.open(result);
                    break;
            }
        } catch (e) {
            logger.error(e);
            await client.chat.postEphemeral({
                text: "An error occurred " + e,
                channel: (body as BlockAction).channel?.id!,
                user: (body as BlockAction).user.id
            });
        }
    }
    );

    return await awsLambdaReceiver.start();
}
const initPromise = init();

// Handle the Lambda function event
module.exports.handler = async (event: APIGatewayProxyEvent, context: any, callback: any) => {
    const handler = await initPromise;
    logger.debug("EVENT RECEIVED " + JSON.stringify(event));
    return handler(event, context, callback);
}