import {App, AwsLambdaReceiver, LogLevel, ModalView, ViewOutput} from '@slack/bolt';
import {AwsSecretsDataSource} from "./secrets/AwsSecretsDataSource";
import {context, logger} from "./utils/context";
import {APIGatewayProxyEvent} from "aws-lambda";
import {SlackBot} from "./bot/SlackBot";
import {DynamoDbStandupParkingLotDataDao} from "./data/DynamoDbStandupParkingLotDataDao";

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
                let payload = slackBot.buildModalView(body, logger);
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
        let chatPostMessageArguments = await slackBot.createAndHandleChatMessageFromViewOutput(view, client, logger);
        try {
            await client.chat.postMessage(chatPostMessageArguments);
            await ack();
            const disclaimer = await slackBot.createChatMessageEditDisclaimer(view);
            await client.chat.postEphemeral(disclaimer);
        } catch (error) {
            logger.error(error);
            let msg = (error as Error).message;
            if (msg.includes("not_in_channel")) {
                msg = ":x: Standup is a member of this channel. Please try again after adding it. Add through *Integrations* or by mentioning it, like " +
                    "`@Standup`."
            }
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
            };
            try {
                logger.info(viewArgs);
                await ack({
                        response_action: "update",
                        view: viewArgs
                    }
                );
            } catch (e) {
                logger.error("Secondary error", e);
            }
        }
    });

    return await awsLambdaReceiver.start();
}
const initPromise = init();

// Handle the Lambda function event
module.exports.handler = async (event: APIGatewayProxyEvent, context: any, callback: any) => {
    const handler = await initPromise;
    logger.debug("EVENT RECEIVED " + JSON.stringify(event));
    return handler(event, context, callback);
}