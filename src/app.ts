import {App, AwsLambdaReceiver, BlockAction, LogLevel, ModalView} from '@slack/bolt';
import {AwsSecretsDataSource} from "./secrets/AwsSecretsDataSource";
import {context, logger} from "./utils/context";
import {APIGatewayProxyEvent} from "aws-lambda";
import {SlackBot} from "./bot/SlackBot";
import {DynamoDbStandupParkingLotDataDao} from "./data/DynamoDbStandupParkingLotDataDao";
import {ChatScheduleMessageArguments, WebClient} from "@slack/web-api";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {formatDateToPrintable} from "./utils/datefunctions";

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
                let payload = await slackBot.buildModalView(body, client, logger);
                const result = await client.views.open(
                    payload
                );
                logger.debug(result);
            } catch (error) {
                logger.error(error);
            }
        }
    });

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
            if(viewInput.scheduleDateTime) {
                let scheduleStr = formatDateToPrintable(viewInput.scheduleDateTime, viewInput.timezone!);
                const chatMessageArgs = await slackBot.createChatMessageAndSaveData("scheduled", viewInput, client, logger);
                console.log("Scheduling message for " + scheduleStr + " with input " + viewInput.scheduleDateTime);
                // Unix timestamp is seconds since epoch
                chatMessageArgs.post_at = viewInput.scheduleDateTime / 1000;
                let scheduleResponse = await client.chat.scheduleMessage(chatMessageArgs as ChatScheduleMessageArguments);

                const date = new Date(scheduleResponse.post_at! * 1000);
                // @ts-ignore
                console.log(`Message id ${scheduleResponse.scheduled_message_id} scheduled to send ${formatDateToPrintable(date.getTime(), viewInput.timezone)} for channel ${scheduleResponse.channel} `);

                // Use the response to create a dialog
                let msgId = scheduleResponse.scheduled_message_id!;
                let confMessage = slackBot.buildScheduledMessageDelete(msgId,
                    viewInput.pm.channelId!,
                    viewInput.scheduleDateTime,
                    viewInput.pm.userId!,
                    viewInput.timezone!,
                    chatMessageArgs as ChatScheduleMessageArguments);

                await client.chat.postEphemeral(confMessage);
            }
            else {
                const chatMessageArgs = await slackBot.createChatMessageAndSaveData("post", viewInput, client, logger);
                await client.chat.postMessage(chatMessageArgs);
                const disclaimer = slackBot.createChatMessageEditDisclaimer(viewInput);
                await client.chat.postEphemeral(disclaimer);
            }
        } catch (error) {
            logger.error(error);
            let msg = (error as Error).message;
            const viewArgs = slackBot.buildErrorView(msg);
            try {
                logger.info(viewArgs);
                await ack({
                   response_action: "update",
                   view: viewArgs
                });

            } catch (e) {
                logger.error("Secondary error", e);
            }
        }
    });

    app.action({action_id: "delete-msg-action", block_id: "delete-msg"}, async ({body,  ack, say, logger, client }) => {
        try {
            await ack();
            let result = await slackBot.deleteScheduledMessage(body as BlockAction, client, logger);
            await client.chat.postEphemeral(result as ChatPostEphemeralArguments);
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