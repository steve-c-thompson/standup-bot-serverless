import {AckFn, App, AwsLambdaReceiver, BlockAction, ButtonAction, LogLevel, ViewResponseAction} from '@slack/bolt';
import {appContext, blockId, dataSource, logger} from "./utils/appContext";
import {APIGatewayProxyEvent} from "aws-lambda";
import {SlackBot} from "./bot/SlackBot";
import {
    ChatPostMessageResponse,
    ChatScheduleMessageArguments,
    ChatScheduleMessageResponse,
    ChatUpdateArguments, ChatUpdateResponse,
    WebClient
} from "@slack/web-api";
import {DynamoDbStandupStatusDao} from "./data/DynamoDbStandupStatusDao";
import {StandupViewData} from "./dto/StandupViewData";
import {Timer} from "./utils/Timer";
import {delegateToWorker, warmWorkerLambda} from "./utils/lambdautils";
import {ChangeMessageCommand} from "./bot/Commands";
import {formatDateToPrintableWithTime} from "./utils/datefunctions";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {ACTION_NAMES} from "./bot/ViewConstants";

let app: App;

let receiver: AwsLambdaReceiver;

const logLevel = LogLevel.INFO;

const timerEnabled = true;

/**
 * This is a slack bot that allows users to enter their standup status.
 *
 * This uses the @slack/bolt framework to handle the slack events and interactions.
 * https://slack.dev/bolt-js/tutorial/getting-started
 *
 * See the README for how to configure the bot
 *
 * async init() function is used to initialize the bot. This is called from the lambda handler, and used
 * so that we can avoid initializing the bot on every lambda invocation.
 *
 * https://serverlessfirst.com/function-initialisation/
 */
const init = async () => {
    const signingSecret = await dataSource.slackSigningSecret();
    const slackBotToken = await dataSource.slackToken();

    const statusDao = new DynamoDbStandupStatusDao(appContext.dynamoDbClient);
    const slackBot: SlackBot = new SlackBot(statusDao);

    // Receiver provided by the @slack/bolt framework
    // Save the headers so that they can be extracted from context. Forwarding does not work otherwise.
    receiver = new AwsLambdaReceiver({
        signingSecret: signingSecret,
        logLevel: logLevel,
        customPropertiesExtractor: (event: APIGatewayProxyEvent) => {
            return {
                "headers": event.headers,
            };
        }
    });
    app = new App({
        token: slackBotToken,
        receiver: receiver,
        logLevel: logLevel,
    });

    /**
     * Handle the /standup command. This launches the modal view.
     *
     * Note: ideally we would check if the bot is in the channel, but that is not possible with the current slack api.
     */
    app.command("/standup", async ({ack, body, client, logger, }) => {
        await ack();

        let args = body.text;
        const today = new Date();

        if (args == "help") {
            let message = "How to use /standup"
            let attachments = [];
            attachments.push({
                "text": "`/standup` and enter your status in the modal"
                    + "\n`/standup [parking-lot | parking_lot | parkinglot | -p]` to display items in the parking lot (visible only to you)"
                    + "\n`/standup post [parking-lot | parking_lot | parkinglot | -p]` to post parking lot items to channel"

            });
            await slackBot.messageWithSlackApi(body.user_id, today, client, "chat.postEphemeral", {
                text: message,
                attachments: attachments,
                channel: body.channel_id,
                user: body.user_id
            }, false);
        } else if (args == "parking-lot" || args == "parking_lot" || args == "parkinglot" || args == "-p") {
            const userTzOffset = await slackBot.getUserTimezoneOffset(body.user_id, client);
            const parkingLotMsg = await slackBot.buildParkingLotDisplayData(body.channel_id, new Date(), userTzOffset, client);
            await slackBot.messageWithSlackApi(body.user_id, today, client, "chat.postEphemeral",
                {
                    text: ":car: *Parking Lot*\n" + parkingLotMsg,
                    channel: body.channel_id,
                    user: body.user_id
                }, false);
        } else if (args == "post parking-lot" || args == "post parking_lot" || args == "post parkinglot" || args == "post -p") {
            const userTzOffset = await slackBot.getUserTimezoneOffset(body.user_id, client);
            const parkingLotMsg = await slackBot.buildParkingLotDisplayData(body.channel_id, new Date(), userTzOffset, client);
            await slackBot.messageWithSlackApi(body.user_id, today, client, "chat.postMessage", {
                text: ":car: *Parking Lot*\n" + parkingLotMsg,
                channel: body.channel_id,
                user: body.user_id,
            }, false);
        } else {
            try {
                let payload = await slackBot.buildNewMessageModalView(body, client);
                const result = await slackBot.messageWithSlackApi(body.user_id, today, client, "views.open",
                    payload
                    , false);
                // const result = await client.views.open(payload);
                logger.debug(result);
            } catch (error) {
                logger.error(error);
            }
        }
    });


    async function validateBotUserInChannel(ack: AckFn<ViewResponseAction> | AckFn<void>, client: WebClient, botId: string, viewInput: StandupViewData): Promise<boolean> {
        // Check if the bot is in channel. If not, update view with error
        if (!await slackBot.validateBotUserInChannel(viewInput.pm.channelId!, botId, client)) {
            logger.error("Standup bot is not a member of channel " + viewInput.pm.channelId);
            const msg = ":x: Standup is not a member of this channel. Please try again after adding it. Add through *Integrations* or by mentioning it, like " +
                "`@Standup`."
            const viewArgs = slackBot.buildErrorView(msg);

            await ack({
                    response_action: "update",
                    view: viewArgs
                }
            );
            return false;
        }
        return true;
    }

    /**
     *  Validate that the bot is in channel, then delegate to a worker lambda.
     */
    app.view("standup_view", async ({ack, body, view, client, logger, context}) => {
        let timer = new Timer();
        if(timerEnabled) {
            timer.startTimer();
        }
        const viewInput = slackBot.getViewInputValues(view);
        const botId = body.view.bot_id;

        // Check if the bot is in channel. If not, update view with error
        if (!await validateBotUserInChannel(ack, client, botId, viewInput)) {
            return;
        }

        // Delegate processing to a worker
        await delegateToWorker(body, context, signingSecret, logger);

        // TODO maybe update the view with a "processing" message

        // ack the request
        await ack();
        if(timerEnabled) {
            timer.logElapsed("Acknowledge view submission", logger);
        }
    });

    /**
     * Handle the action of a button press from the change-msg block in the posted message.
     *
     * ack() the request and then forward the request to another lambda function.
     */
    app.action({block_id: blockId}, async ({ack, body, client, logger, context}) => {
        // logger.info("Action received: ", JSON.stringify(body, null, 2));
        await ack();

            await delegateToWorker(body, context, signingSecret, logger);
        }
    );

    return receiver.start();
}
// Store the init promise in module scope so that subsequent calls to init() return the resolved promise
const initPromise = init();

/**
 * Handle the lambda event, wrapping the ExpressReceiver's app with the serverless handler.
 * https://www.npmjs.com/package/serverless-http
 * @param event
 * @param context
 * @param callback
 */
module.exports.handler = async (event: any, context: any, callback: any) => {
    const handler = await initPromise;
    // logger.info("APP EVENT RECEIVED " + JSON.stringify(event, null, 2));
    // Look for events from serverless-plugin-warmup or AWS scheduled events
    if(event.source === 'serverless-plugin-warmup' || event.source === 'aws.events') {
        // Warmup event from serverless-plugin-warmup
        // https://www.npmjs.com/package/serverless-plugin-warmup
        return "App Lambda warmed up";
    }
    // Warm the worker lambda so it can accept requests, but only when an actual request is received
    // -- Let provisioned concurrency handle this
    // warmWorkerLambda();
    return handler(event, context, callback);
}
