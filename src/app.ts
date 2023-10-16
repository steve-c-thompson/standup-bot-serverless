import {
    AckFn,
    App,
    AwsLambdaReceiver,
    BlockAction,
    ButtonAction,
    Logger,
    LogLevel,
    SlackAction,
    SlackViewAction,
    ViewResponseAction
} from '@slack/bolt';
import {appContext, blockId, logger} from "./utils/appContext";
import {SlackBot} from "./bot/SlackBot";
import {
    ChatPostMessageResponse,
    ChatScheduleMessageArguments,
    ChatScheduleMessageResponse,
    ChatUpdateArguments,
    ChatUpdateResponse,
    WebClient
} from "@slack/web-api";
import {DynamoDbStandupStatusDao} from "./data/DynamoDbStandupStatusDao";
import {StandupViewData} from "./dto/StandupViewData";
import {Timer} from "./utils/Timer";
import {ChangeMessageCommand} from "./bot/Commands";
import {formatDateToPrintableWithTime} from "./utils/datefunctions";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {ACTION_NAMES} from "./bot/ViewConstants";
import {AwsSecretsDataSource} from "./secrets/AwsSecretsDataSource";
	
import { Tracer } from '@aws-lambda-powertools/tracer';
import { endTrace, startTrace } from './utils/tracing';

const tracer = new Tracer();

/**
 * This is a slack bot that allows users to enter their standup status.
 *
 * This uses the @slack/bolt framework to handle the slack events and interactions.
 * https://slack.dev/bolt-js/tutorial/getting-started
 *
 * See the README for how to configure the bot
 *
 * async init() function is used to initialize the bot. This is called from the lambda handler, and used
 * so that we can avoid initializing the bot on every lambda invocation. See the following for more details:
 *
 * https://serverlessfirst.com/function-initialisation/
 *
 * Exceptions are bubbled up to the lambda handler so that if there is an error, the lambda will fail. For
 * example, if retrieving the signing secret fails, the bot will not be able to verify the request, so we don't
 * want that lambda hanging around.
 */
const init = async () => {
    
    const logLevel = LogLevel.INFO;

    const timerEnabled = false;

    const dataSource = new AwsSecretsDataSource(appContext.secretsManager);
    const signingSecret = await dataSource.slackSigningSecret();
    const slackBotToken = await dataSource.slackToken();

    const statusDao = new DynamoDbStandupStatusDao(appContext.dynamoDbClient);
    const slackBot: SlackBot = new SlackBot(statusDao);

    // Receiver provided by the @slack/bolt framework
    const receiver = new AwsLambdaReceiver({
        signingSecret: signingSecret,
        logLevel: logLevel,
    });
    const app = new App({
        token: slackBotToken,
        receiver: receiver,
        logLevel: logLevel,
    });

    /**
     * Handle the /standup command. This launches the modal view.
     *
     * Note: ideally we would check if the bot is in the channel, but that is not possible with the current slack api.
     */
    app.command("/standup", async ({ack, body, client, logger,}) => {
        
        // const sp = startTrace(tracer, "/standup");
        await ack();

        const args = body.text;
        const today = new Date();

        if (args == "help") {
            const message = "How to use /standup"
            const attachments = [
            {
                "text": "`/standup` and enter your status in the modal"
                    + "\n`/standup [parking-lot | parking_lot | parkinglot | -p]` to display items in the parking lot (visible only to you)"
                    + "\n`/standup post [parking-lot | parking_lot | parkinglot | -p]` to post parking lot items to channel"

            }
            ];
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
                const payload = await slackBot.buildNewMessageModalView(body, client);
                const result = await slackBot.messageWithSlackApi(body.user_id, today, client, "views.open",
                    payload
                    , false);
                // const result = await client.views.open(payload);
                logger.debug(result);
            } catch (error) {
                logger.error(error);
                throw error;
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
    app.view("standup_view", async ({ack, body, view, client, logger}) => {
        // const sp = startTrace(tracer, "standup_view");
        const timer = new Timer();
        if (timerEnabled) {
            timer.startTimer();
        }
        const viewInput = slackBot.getViewInputValues(view);
        const botId = body.view.bot_id;

        // Check if the bot is in channel. If not, update view with error
        if (!await validateBotUserInChannel(ack, client, botId, viewInput)) {
            return;
        }
        // ack the request
        await ack();
        if (timerEnabled) {
            timer.logElapsed("Acknowledge view submission", logger);
        }

        await handleStandupModalSubmission(viewInput, body, client, logger);
        // endTrace(tracer, sp);
    });

    async function handleStandupModalSubmission(viewInput: StandupViewData, body: SlackViewAction, client: WebClient, logger: Logger) {
        // const sp = startTrace(tracer, "/standup");
        try {
            // When a messageId is present we are editing a message
            const isEdit = !!viewInput.pm.messageId;
            const channelId = viewInput.pm.channelId!;
            const userId = viewInput.pm.userId!;
            const today = new Date();

            const appId = body.api_app_id;
            const teamId = body.team?.id;

            // If the message type is scheduled but there is no scheduleDateTime, this message
            // must be deleted and posted to channel
            if (viewInput.pm.messageType === "scheduled" && isEdit) {
                // If this is an edit schedule message, delete the existing one
                const command = new ChangeMessageCommand(viewInput.pm.messageId!, channelId, userId,
                    viewInput.pm.messageDate!);
                await slackBot.deleteScheduledMessage(command, client, logger);
                // Don't update the user, but do update the home screen
                // await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral",
                //     result as ChatPostEphemeralArguments, true);
                await slackBot.updateHomeScreen(userId, new Date(), client);
            }
            // If we have a scheduleDateTime, schedule a new message
            if (viewInput.scheduleDateTime) {
                // Schedule a new message
                const scheduleStr = formatDateToPrintableWithTime(viewInput.scheduleDateTime, viewInput.timezone!);

                const chatMessageArgs = await slackBot.createChatMessage(viewInput, client);
                logger.info("Scheduling message for " + scheduleStr + " with input " + viewInput.scheduleDateTime);
                // Unix timestamp is seconds since epoch
                chatMessageArgs.post_at = viewInput.scheduleDateTime / 1000;
                const scheduleResponse = await slackBot.messageWithSlackApi(userId, today, client, "chat.scheduleMessage",
                    chatMessageArgs as ChatScheduleMessageArguments, true) as ChatScheduleMessageResponse;

                const saveDate = new Date(viewInput.scheduleDateTime);
                // Save message data for next view
                viewInput.pm.messageId = scheduleResponse.scheduled_message_id!;
                viewInput.pm.messageDate = saveDate.getTime();
                // timezone is assumed present with scheduleDateTime
                await slackBot.saveStatusData(viewInput, saveDate, "scheduled", viewInput.timezone!);

                const msgId = scheduleResponse.scheduled_message_id!;
                // Response userID is bot ID, get this data from PrivateMetadata
                const command = new ChangeMessageCommand(msgId, channelId, userId,
                    viewInput.scheduleDateTime);
                const confMessage = slackBot.buildScheduledMessageConfirmationAndLink(command, viewInput.timezone!, appId, teamId!, chatMessageArgs.blocks!);

                await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral", confMessage, true);
            }
            // No scheduleDateTime means we are not scheduling anything and must interact with the chat
            else {
                if (isEdit && viewInput.pm.messageType === "posted") {
                    // We are editing a posted message, so update using slack's API
                    const chatMessageArgs = await slackBot.createChatMessage(viewInput, client) as ChatUpdateArguments;
                    // Update the message using the API
                    // but wait to update the home screen
                    const result = await slackBot.messageWithSlackApi(userId, today, client, "chat.update", chatMessageArgs, false) as ChatUpdateResponse;

                    const saveDate = new Date(viewInput.pm.messageDate!);
                    // set the timezone for saving
                    const tz = await slackBot.getUserTimezoneOffset(userId, client);
                    viewInput.pm.messageId = result.ts;
                    await slackBot.saveStatusData(viewInput, saveDate, "posted", tz);

                    // Print the result of the attempt
                    const appHomeLinkBlocks = slackBot.buildAppHomeLinkBlocks(appId, teamId!);
                    if (result.ok) {
                        logger.info(`Message ${result.ts} updated`);
                        // No need to message the user, the message is updated in the channel
                        const msg = await slackBot.buildEphemeralContextMessage(result.channel!, userId, appHomeLinkBlocks, "Your status was updated");
                        await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral", msg, true);
                    } else {
                        const msg = await slackBot.buildEphemeralContextMessage(channelId, userId, appHomeLinkBlocks, result.error!);
                        await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral", msg, true);
                    }
                    // Now update the home screen
                    await slackBot.updateHomeScreen(userId, new Date(), client);
                }
                // Not editing an existing posted message
                else {
                    viewInput.pm.messageType = "posted";
                    const chatMessageArgs = await slackBot.createChatMessage(viewInput, client);
                    // Don't update home screen because next message will
                    const result = await slackBot.messageWithSlackApi(userId, today, client, "chat.postMessage",
                        chatMessageArgs, false) as ChatPostMessageResponse;
                    const standupDate = new Date();
                    viewInput.pm.messageId = result.ts!;
                    viewInput.pm.messageDate = standupDate.getTime();
                    const tz = await slackBot.getUserTimezone(userId, client);
                    await slackBot.saveStatusData(viewInput, standupDate, "posted", tz);

                    const appHomeLinkBlocks = slackBot.buildAppHomeLinkBlocks(appId, teamId!);
                    // Message the user to provide a link to the home screen
                    const msg = await slackBot.buildEphemeralContextMessage(channelId, userId, appHomeLinkBlocks);
                    await slackBot.messageWithSlackApi(userId, new Date(), client, "chat.postEphemeral", msg, true);
                }
            }
        } catch (error) {
            logger.error(error);
            const msg = (error as Error).message;
            const viewArgs = slackBot.buildErrorMessage(viewInput.pm.channelId!, viewInput.pm.userId!, msg) as ChatPostEphemeralArguments;
            try {
                await slackBot.messageWithSlackApi(viewInput.pm.userId!, new Date(), client, "chat.postEphemeral", viewArgs);
            } catch (e) {
                logger.error(viewArgs);
                logger.error("Secondary error", e);
            }
        }
        // finally {
        //     endTrace(tracer, sp);
        // }
    }

    /**
     * Handle the action of a button press from the change-msg block in the posted message.
     *
     * ack() the request and then forward the request to another lambda function.
     */
    app.action({block_id: blockId}, async ({ack, body, client, logger}) => {
            // logger.info("Action received: ", JSON.stringify(body, null, 2));
            const timer = new Timer();
            if (timerEnabled) {
                timer.startTimer();
            }

            await ack();
            if (timerEnabled) {
                timer.logElapsed("Acknowledge action", logger);
            }

            await handleActionSubmit(body, client, logger);
        }
    );

    async function handleActionSubmit(body: SlackAction, client: WebClient, logger: Logger) {
        // const sp = startTrace(tracer, "/standup");
        try {
            const action = (body as BlockAction)["actions"][0];
            let result;
            let cmd, triggerId;
            const msgVal = (action as ButtonAction).value;
            switch (action.action_id) {
                case ACTION_NAMES.get("DELETE_SCHEDULED_MESSAGE"):
                    cmd = ChangeMessageCommand.buildFromString(msgVal);
                    result = await slackBot.deleteScheduledMessage(cmd!, client, logger);
                    // TODO add a block to the home screen, maybe by passing a message ID and block to add to that message
                    await slackBot.messageWithSlackApi(cmd!.userId, new Date(), client, "chat.postEphemeral", result as ChatPostEphemeralArguments, true);
                    break;
                case ACTION_NAMES.get("EDIT_SCHEDULED_MESSAGE"):
                    logger.info("Edit Request for scheduled message " + msgVal);
                    cmd = ChangeMessageCommand.buildFromString(msgVal);
                    triggerId = (body as BlockAction).trigger_id;
                    result = await slackBot.buildModalViewForScheduleUpdate(cmd!, triggerId, client);
                    await slackBot.messageWithSlackApi(cmd!.userId, new Date(), client, "views.open", result);
                    break;
                case ACTION_NAMES.get("EDIT_MESSAGE"):
                    logger.info("Edit Request for posted message " + msgVal);
                    cmd = ChangeMessageCommand.buildFromString(msgVal);
                    triggerId = (body as BlockAction).trigger_id;
                    result = await slackBot.buildModalViewForPostUpdate(cmd!, triggerId, client);
                    await slackBot.messageWithSlackApi(cmd!.userId, new Date(), client, "views.open", result);
                    break;
            }
        } catch (e) {
            logger.error(e);
            await slackBot.messageWithSlackApi((body as BlockAction).user.id, new Date(), client, "chat.postEphemeral", {
                text: "An error occurred " + e,
                channel: (body as BlockAction).channel!.id!,
                user: (body as BlockAction).user.id
            });
        }
        // finally {
        //     endTrace(tracer, sp);
        // }
    }
    // logger.info("App initialized");
    // if (initSegment && segment){
    //     initSegment.close();

    //     // Set the facade segment as active again (the one created by Lambda)
    //     tracer.setSegment(segment);
    // }
    return receiver.start();
}
// Store the init promise in module scope so that subsequent calls to init() return the resolved promise

// top-level await for esmodule
const initPromise = await init();

/**
 * Handle the lambda event. This is the entry point for the lambda function.
 * This will be warmed up by the serverless-plugin-warmup plugin or by AWS scheduled events.
 * https://www.npmjs.com/package/serverless-http
 * @param event
 * @param context
 * @param callback
 */
export const handler = async (event: any, context: any, callback: any) => {
    const sp = startTrace(tracer, `## ${process.env._HANDLER}`);

    // Annotate the subsegment with the cold start and serviceName
    tracer.annotateColdStart();
    tracer.addServiceNameAnnotation();

    // Add annotation for the awsRequestId
    tracer.putAnnotation('awsRequestId', context.awsRequestId);

    const handler = initPromise;
    // logger.info("APP EVENT RECEIVED " + JSON.stringify(event, null, 2));
    // Look for events from serverless-plugin-warmup or AWS scheduled events
    if(event.source === 'serverless-plugin-warmup' || event.source === 'aws.events') {
        // Warmup event from serverless-plugin-warmup
        // https://www.npmjs.com/package/serverless-plugin-warmup
        return "App Lambda warmed up";
    }

    endTrace(tracer, sp);

    return handler(event, context, callback);
}

