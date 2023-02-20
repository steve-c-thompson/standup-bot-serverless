import {App, BlockAction, ButtonAction, ExpressReceiver, LogLevel} from '@slack/bolt';
import {appContext, blockId, dataSource, logger} from "./utils/appContext";
import {SlackBot} from "./bot/SlackBot";
import {
    ChatPostMessageResponse,
    ChatScheduleMessageArguments,
    ChatScheduleMessageResponse,
    ChatUpdateArguments,
    ChatUpdateResponse
} from "@slack/web-api";
import {ChatPostEphemeralArguments} from "@slack/web-api/dist/methods";
import {formatDateToPrintableWithTime} from "./utils/datefunctions";
import {ChangeMessageCommand} from "./bot/Commands";
import {ACTION_NAMES} from "./bot/ViewConstants";
import {DynamoDbStandupStatusDao} from "./data/DynamoDbStandupStatusDao";

const serverless = require('serverless-http');

let app: App;

let workerReceiver: ExpressReceiver;

const logLevel = LogLevel.INFO;

/**
 * This is a worker lambda to handle long-running functions. Its purpose is to
 * receive invocations from the another bot handler lambda and then do the work,
 * because sometimes that work takes longer than 3 seconds.
 */
const init = async () => {
    const signingSecret = await dataSource.slackSigningSecret();
    const slackBotToken = await dataSource.slackToken();

    const statusDao = new DynamoDbStandupStatusDao(appContext.dynamoDbClient);
    const slackBot: SlackBot = new SlackBot(statusDao);

    // Receiver provided by the @slack/bolt framework
    workerReceiver = new ExpressReceiver({
        signingSecret: signingSecret,
        logLevel: logLevel,
        endpoints: {events: "/worker/events"},
        logger: logger,
        processBeforeResponse: true,
        signatureVerification: true    // Default, leaving here for clarity
    });
    app = new App({
        token: slackBotToken,
        receiver: workerReceiver,
        logLevel: logLevel,
        logger: logger,
        processBeforeResponse: true,
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
        // logger.info("WORKER RECEIVED VIEW SUBMISSION");
        const viewInput = slackBot.getViewInputValues(view);

        await ack();
        try {
            // When a messageId is present we are editing a message
            const isEdit: boolean = !!viewInput.pm.messageId;
            const channelId = viewInput.pm.channelId!;
            const userId = viewInput.pm.userId!;
            const today = new Date();

            const appId = body.api_app_id;
            const teamId = body.team?.id;

            // If the message type is scheduled but there is no scheduleDateTime, this message
            // must be deleted and posted to channel
            if (viewInput.pm.messageType === "scheduled" && isEdit) {
                // If this is an edit schedule message, delete the existing one
                let command = new ChangeMessageCommand(viewInput.pm.messageId!, channelId, userId,
                    viewInput.pm.messageDate!);
                const result = await slackBot.deleteScheduledMessage(command, client, logger);
                // Post the result as an ephemeral message.
                await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral",
                    result as ChatPostEphemeralArguments, true);
            }
            // If we have a scheduleDateTime, schedule a new message
            if (viewInput.scheduleDateTime) {
                // Schedule a new message
                let scheduleStr = formatDateToPrintableWithTime(viewInput.scheduleDateTime, viewInput.timezone!);

                const chatMessageArgs = await slackBot.createChatMessage(viewInput, client);
                logger.info("Scheduling message for " + scheduleStr + " with input " + viewInput.scheduleDateTime);
                // Unix timestamp is seconds since epoch
                chatMessageArgs.post_at = viewInput.scheduleDateTime / 1000;
                let scheduleResponse = await slackBot.messageWithSlackApi(userId, today, client, "chat.scheduleMessage",
                    chatMessageArgs as ChatScheduleMessageArguments, true) as ChatScheduleMessageResponse;
                try {
                    const saveDate = new Date(viewInput.scheduleDateTime);
                    // Save message data for next view
                    viewInput.pm.messageId = scheduleResponse.scheduled_message_id!;
                    viewInput.pm.messageDate = saveDate.getTime();
                    // timezone is assumed present with scheduleDateTime
                    await slackBot.saveStatusData(viewInput, saveDate, "scheduled", viewInput.timezone!);
                } catch (e) {
                    logger.error(e);
                }

                const date = new Date(scheduleResponse.post_at! * 1000);
                // @ts-ignore
                // logger.info(`Message id ${scheduleResponse.scheduled_message_id} scheduled to send ${formatDateToPrintableWithTime(date.getTime(), viewInput.timezone)} for channel ${scheduleResponse.channel} `);

                const msgId = scheduleResponse.scheduled_message_id!;
                // Response userID is bot ID, get this data from PrivateMetadata
                let command = new ChangeMessageCommand(msgId, channelId, userId,
                    viewInput.scheduleDateTime);
                let confMessage = slackBot.buildScheduledMessageConfirmationAndLink(command, viewInput.timezone! ,appId, teamId!, chatMessageArgs.blocks!);

                await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral", confMessage, true);
            }
            // No scheduleDateTime means we are not scheduling anything and must interact with the chat
            else {
                if (isEdit && viewInput.pm.messageType === "posted") {
                    // We are editing a posted message, so update using slack's API
                    const chatMessageArgs = await slackBot.createChatMessage(viewInput, client) as ChatUpdateArguments;
                    // Update the message using the API
                    const result = await slackBot.messageWithSlackApi(userId, today, client, "chat.update", chatMessageArgs, true) as ChatUpdateResponse;
                    try {
                        const saveDate = new Date(viewInput.pm.messageDate!);
                        // set the timezone for saving
                        const tz = await slackBot.getUserTimezoneOffset(userId, client);
                        viewInput.pm.messageId = result.ts;
                        await slackBot.saveStatusData(viewInput, saveDate, "posted", tz);
                    } catch (e) {
                        logger.error("Error editing posted message ", e);
                    }
                    // Print the result of the attempt
                    const appHomeLinkBlocks = slackBot.buildAppHomeLinkBlocks(appId, teamId!);
                    if (result.ok) {
                        logger.info(`Message ${result.ts} updated`);
                        const msg = await slackBot.buildEphemeralContextMessage(result.channel!, userId, appHomeLinkBlocks, "Your status was updated");
                        await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral", msg, true);
                    } else {
                        const msg = await slackBot.buildEphemeralContextMessage(channelId, userId, appHomeLinkBlocks, result.error!);
                        await slackBot.messageWithSlackApi(userId, today, client, "chat.postEphemeral", msg, true);
                    }
                }
                // Not editing an existing posted message
                else {
                    viewInput.pm.messageType = "posted";
                    const chatMessageArgs = await slackBot.createChatMessage(viewInput, client);
                    const result = await slackBot.messageWithSlackApi(userId, today, client, "chat.postMessage",
                        chatMessageArgs, true) as ChatPostMessageResponse;
                    const standupDate = new Date();
                    viewInput.pm.messageId = result.ts!;
                    viewInput.pm.messageDate = standupDate.getTime();
                    const tz = await slackBot.getUserTimezone(userId, client);
                    try {
                        await slackBot.saveStatusData(viewInput, standupDate, "posted", tz);
                    } catch (e) {
                        logger.error(e);
                    }

                    const appHomeLinkBlocks = slackBot.buildAppHomeLinkBlocks(appId, teamId!);
                    const msg = await slackBot.buildEphemeralContextMessage(channelId, userId, appHomeLinkBlocks);
                    await slackBot.messageWithSlackApi(userId, new Date(), client, "chat.postEphemeral", msg, true);
                }
            }
        } catch (error) {
            logger.error(error);
            let msg = (error as Error).message;
            const viewArgs = slackBot.buildErrorMessage(viewInput.pm.channelId!, viewInput.pm.userId!, msg) as ChatPostEphemeralArguments;
            try {
                await slackBot.messageWithSlackApi(viewInput.pm.userId!, new Date(), client, "chat.postEphemeral", viewArgs);
            } catch (e) {
                logger.error(viewArgs);
                logger.error("Secondary error", e);
            }
        }
    });

    /**
     * Handle the action of a button press from the change-msg block in the posted message.
     */
    app.action({block_id: blockId}, async ({ack, body, client, logger}) => {
            // logger.info("Worker action received: ", JSON.stringify(body, null, 2));
            await ack();
            try {
                const action = (body as BlockAction)["actions"][0];
                let result;
                let cmd, triggerId;
                const msgVal = (action as ButtonAction).value;
                switch (action.action_id) {
                    case ACTION_NAMES.get("DELETE_SCHEDULED_MESSAGE"):
                        cmd = ChangeMessageCommand.buildFromString(msgVal);
                        result = await slackBot.deleteScheduledMessage(cmd!, client, logger);
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
                    channel: (body as BlockAction).channel?.id!,
                    user: (body as BlockAction).user.id
                });
            }
        }
    );

    return workerReceiver.app;
}
// Store the init promise in module scope so that subsequent calls to init() return the resolved promise
const initPromise = init();

// Handle the Lambda function event
module.exports.handler = async (event: any, context: any, callback: any) => {
    logger.info("WORKER Event received: " + JSON.stringify(event, null, 2));
    const handler = serverless(await initPromise);
    return handler(event, context, callback);
}