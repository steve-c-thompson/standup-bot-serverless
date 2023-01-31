import {App, AwsLambdaReceiver, LogLevel, ModalView, ViewOutput} from '@slack/bolt';
import {AwsSecretsDataSource} from "./secrets/AwsSecretsDataSource";
import {context, logger} from "./utils/context";
import {APIGatewayProxyEvent} from "aws-lambda";
import {SlackBot} from "./bot/SlackBot";

let app: App;
const dataSource = new AwsSecretsDataSource(context.secretsManager);

let awsLambdaReceiver: AwsLambdaReceiver;

const logLevel = LogLevel.INFO;

const init = async () => {
    logger.debug("Executing async init");
    const signingSecret = await dataSource.slackSigningSecret();
    const slackBotToken = await dataSource.slackToken();

    const slackBot : SlackBot = new SlackBot();

    awsLambdaReceiver = new AwsLambdaReceiver({
        signingSecret: signingSecret,
        logLevel: logLevel
    });
    app = new App({
        token: slackBotToken,
        receiver: awsLambdaReceiver,
        logLevel: logLevel
    });

    app.command("/standup", async ({ ack, body, client, logger  }) => {
        await ack();

        let args = body.text;

        if(args == "help") {
            let message = "How to use /standup"
            let attachments = [];
            attachments.push({"text": "Type `/standup` and enter data in the modal"
            });
            await client.chat.postEphemeral({
                text: message,
                attachments: attachments,
                channel: body.channel_id,
                user: body.user_id
            });
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

    app.view("standup_view", async ({ ack, body, view, client, logger }) => {
        logger.debug("Handling standup-view submit");

        let chatPostMessageArguments = await slackBot.createChatMessageFromViewOutput(view, client, logger);
       try {
           await client.chat.postMessage (chatPostMessageArguments);
           await ack();
           const disclaimer = await slackBot.createChatMessageEditDisclaimer(view);
           await client.chat.postEphemeral(disclaimer);
       }
       catch (error) {
           logger.error(error);
           let msg = (error as Error).message;
           if(msg.includes("not_in_channel")){
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
module.exports.handler = async (event:APIGatewayProxyEvent, context:any, callback:any) => {
    const handler = await initPromise;
    logger.debug("EVENT RECEIVED " + JSON.stringify(event));
    return handler(event, context, callback);
}