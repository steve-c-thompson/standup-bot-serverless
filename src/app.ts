import {App, AwsLambdaReceiver, BlockAction, ButtonAction, LogLevel} from '@slack/bolt';
import {AwsSecretsDataSource} from "./secrets/AwsSecretsDataSource";
import {context, logger} from "./utils/context";
import {APIGatewayProxyEvent} from "aws-lambda";
import {SlackBot} from "./bot/SlackBot";
import {DynamoDbStandupParkingLotDataDao} from "./data/DynamoDbStandupParkingLotDataDao";
import {ChatScheduleMessageArguments, ChatUpdateArguments} from "@slack/web-api";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {formatDateToPrintable} from "./utils/datefunctions";
import {ChangePostedMessageCommand, ChangeScheduledMessageCommand} from "./bot/Commands";
import {ACTION_NAMES} from "./bot/ViewConstants";

let app: App;
const dataSource = new AwsSecretsDataSource(context.secretsManager);

let awsLambdaReceiver: AwsLambdaReceiver;

const logLevel = LogLevel.INFO;

const init = async () => {
    logger.debug("Executing async init");
    const signingSecret = await dataSource.slackSigningSecret();
    const slackBotToken = await dataSource.slackToken();

    const dao = new DynamoDbStandupParkingLotDataDao(context.dynamoDbClient);

    const slackBot: SlackBot = new SlackBot(dao);

    awsLambdaReceiver = new AwsLambdaReceiver({
        signingSecret: signingSecret,
        logLevel: logLevel
    });
    app = new App({
        token: slackBotToken,
        receiver: awsLambdaReceiver,
        logLevel: logLevel
    });

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
            const parkingLotMsg = await slackBot.buildParkingLotDisplayData(body.channel_id, new Date(), client);
            await client.chat.postEphemeral({
                text: ":car: *Parking Lot*\n" + parkingLotMsg,
                channel: body.channel_id,
                user: body.user_id
            })
        }
        else if (args == "post parking-lot" || args == "post parking_lot" || args == "post parkinglot" || args == "post -p") {
            const parkingLotMsg = await slackBot.buildParkingLotDisplayData(body.channel_id, new Date(), client);
            await client.chat.postMessage({
                text: ":car: *Parking Lot*\n" + parkingLotMsg,
                channel: body.channel_id,
                user: body.user_id,
            })
        }
        else {
            try {
                let payload = await slackBot.buildNewMessageModalView(body, client, logger);
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
     * Much of the functionality relies on `PrivateMetaData.messageType` as well as data received in the submission.
     * If a messageId comes in from the metadata, assume this is a status we must update (posted) or delete (scheduled).
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
            logger.info(viewArgs);
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

            // If the message type is scheduled but there is no scheduleDateTime, this message
            // must be deleted and posted to channel
            if(viewInput.pm.messageType === "scheduled" && isEdit) {
                // If this is an edit schedule message, delete the existing one and proceed
                 let command = new ChangeScheduledMessageCommand(viewInput.pm.messageId!,
                        viewInput.pm.channelId!,
                        viewInput.scheduleDateTime!,
                        viewInput.pm.userId!);
                 const result = await slackBot.deleteScheduledMessage(command, client, logger);
                 await client.chat.postEphemeral(result as ChatPostEphemeralArguments);
            }
            // If we have a scheduleDateTime, schedule a new message
            if(viewInput.scheduleDateTime) {
                // Schedule a new message
                let scheduleStr = formatDateToPrintable(viewInput.scheduleDateTime, viewInput.timezone!);

                const chatMessageArgs = await slackBot.createChatMessageAndSaveData(viewInput, client, logger);
                logger.info("Scheduling message for " + scheduleStr + " with input " + viewInput.scheduleDateTime);
                // Unix timestamp is seconds since epoch
                chatMessageArgs.post_at = viewInput.scheduleDateTime / 1000;
                let scheduleResponse = await client.chat.scheduleMessage(chatMessageArgs as ChatScheduleMessageArguments);

                const date = new Date(scheduleResponse.post_at! * 1000);
                // @ts-ignore
                logger.info(`Message id ${scheduleResponse.scheduled_message_id} scheduled to send ${formatDateToPrintable(date.getTime(), viewInput.timezone)} for channel ${scheduleResponse.channel} `);

                // Use the response to create a dialog
                let msgId = scheduleResponse.scheduled_message_id!;
                let command = new ChangeScheduledMessageCommand(msgId,
                    viewInput.pm.channelId!,
                    viewInput.scheduleDateTime,
                    viewInput.pm.userId!)
                command.messageId = msgId;
                let confMessage = slackBot.buildScheduledMessageDialog(command,
                    viewInput.timezone!,
                    chatMessageArgs as ChatScheduleMessageArguments);

                await client.chat.postEphemeral(confMessage);
            }
            // No scheduleDateTime means we are not scheduling anything and must interact with the chat
            else {
                if(isEdit && viewInput.pm.messageType === "edit") {
                    // We are editing a posted message, so update using slack's API
                    const chatMessageArgs = await slackBot.createChatMessageAndSaveData(viewInput, client, logger) as ChatUpdateArguments;
                    // Update the message using the API
                    const result = await client.chat.update(chatMessageArgs);
                    // Print the result of the attempt
                    if(result.ok){
                        console.log(`Message ${result.ts} updated`);
                        const msg = await slackBot.buildEphemeralContextMessage(result.channel!, viewInput.pm.userId!, "Your status was updated");
                        await client.chat.postEphemeral(msg);
                    }
                    else {
                        const msg = await slackBot.buildEphemeralContextMessage(viewInput.pm.channelId!, viewInput.pm.userId!, result.error!);
                        await client.chat.postEphemeral(msg);
                    }
                }
                // Not editing an existing posted message, so save a new one
                else {
                    viewInput.pm.messageType = "post";
                    const chatMessageArgs = await slackBot.createChatMessageAndSaveData(viewInput, client, logger);
                    const result = await client.chat.postMessage(chatMessageArgs);
                    const cmd = new ChangePostedMessageCommand(result.message?.ts!, result.channel!, viewInput.pm.userId!);
                    const edit = slackBot.buildChatMessageEditDialog(cmd);
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

    app.action({block_id: "change-msg"}, async ({body,  ack, say, logger, client }) => {
        try {
            await ack();
            const action = (body as BlockAction)["actions"][0];
            let result;
            let cmd, triggerId;
            const msgVal = (action as ButtonAction).value;
            switch (action.action_id) {
                case ACTION_NAMES.get("DELETE_SCHEDULED_MESSAGE"):
                    cmd = ChangeScheduledMessageCommand.buildFromString(msgVal);
                    result = await slackBot.deleteScheduledMessage(cmd!, client, logger);
                    await client.chat.postEphemeral(result as ChatPostEphemeralArguments);
                    break;
                case ACTION_NAMES.get("EDIT_SCHEDULED_MESSAGE"):
                    logger.info("Edit Request for scheduled message " + msgVal);
                    cmd = ChangeScheduledMessageCommand.buildFromString(msgVal);
                    triggerId = (body as BlockAction).trigger_id;
                    result = await slackBot.buildModalViewForScheduleUpdate(cmd!, triggerId, client, logger);
                    await client.views.open(result);
                    break;
                case ACTION_NAMES.get("EDIT_MESSAGE"):
                    logger.info("Edit Request for posted message " + msgVal);
                    cmd = ChangePostedMessageCommand.buildFromString(msgVal);
                    triggerId = (body as BlockAction).trigger_id;
                    result = await slackBot.buildModalViewForPostUpdate(cmd!, triggerId, client, logger);
                    await client.views.open(result);
                    break;
            }
        } catch (e) {
            logger.error(e);
            await say("An error occurred " + e);
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