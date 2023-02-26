import {appContext, logger, workerLambdaName} from "./appContext";
import {InvocationType, InvokeCommand, LogType} from "@aws-sdk/client-lambda";
import {Context, Logger} from "@slack/bolt";
import {StringIndexed} from "@slack/bolt/dist/types/helpers";
import {createHmac} from "crypto";

/**
 * Create a request to the worker lambda, passing in the encoded payload `payload=encodedJson
 * @param encodedPayload
 * @param context
 */
function createWorkerLambdaRequest(encodedPayload: string, context: any){
    //TODO the path and resource are hard-coded here, but they should be passed in
    const data = {
        body: encodedPayload,
        headers: context.headers,
        path: "/worker/events",
        resource: "/worker/events",
        httpMethod: "POST",
        // isBase64Encoded: false,
        // queryStringParameters: null,
        // multiValueQueryStringParameters: null,
        // multiValueHeaders: context.multiValueHeaders,
        // stageVariables: null,
        // requestContext: context.requestContext,
        // pathParameters: null,
    }
    return data;
}

function createPayloadString(body: string) {
    return "payload=" + body;
}



/**
 * Send a lambda request
 *
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-lambda/
 *
 * @param data
 * @param logger
 */
async function executeLambdaSend(data: { headers: any; path: string; resource: string; body: string; httpMethod: string }, logger: Logger) {
    // logger.info("LAMBDA FORWARDING to " + workerLambdaName + " with data: " + JSON.stringify(data, null, 2));
    try {
        const result = await appContext.lambdaClient.send(new InvokeCommand({
            FunctionName: workerLambdaName,
            LogType: LogType.Tail,
            InvocationType: InvocationType.Event,
            Payload: Buffer.from(JSON.stringify(data)),
        }));
        // logger.info("Lambda result: " + JSON.stringify(result, null, 2));
    } catch (error) {
        logger.error("Lambda Error " + JSON.stringify(error, null, 2));
    }
}

// https://github.com/slackapi/bolt-js/issues/914#issuecomment-870079306
/**
 * Send the body of the request to the worker lambda. Functionality depends on headers from the original request,
 * set via custom middleware in the receiver.
 *
 *
 * @param body
 * @param context
 * @param secret
 * @param logger
 */
export async function delegateToWorker(body: any, context:Context, secret: string, logger: Logger) {
    replaceHeaderValue(context.headers, 'X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString());

    // Encode the body and format so that the outbound lambda request body matches the one used for the signature.
    // REQUEST HANDLING WILL NOT WORK UNLESS PAYLOAD IN SIGNATURE AND REQUEST MATCH
    const fullPlayload = createPayloadString(encodeURIComponent(JSON.stringify(body)));

    // re-sign the request because the paylod may have changed
    const sig = createSlackSignature(secret, context.headers, fullPlayload);
    replaceHeaderValue(context.headers, 'X-Slack-Signature', sig);

    const data = createWorkerLambdaRequest(fullPlayload, context);
    await executeLambdaSend(data, logger);
}

/**
 * Send an empty request to the worker lambda.
 */
export async function warmWorkerLambda() {
    const data = createWorkerLambdaRequest("", {headers: {}});
    executeLambdaSend(data, logger);
}
// https://api.slack.com/authentication/verifying-requests-from-slack#verifying-requests-from-slack-using-signing-secrets__a-recipe-for-security__how-to-make-a-request-signature-in-4-easy-steps-an-overview
/**
 * Create a signature for a request from Slack
 * See @slack/bolt-js/src/receivers/ExpressReceiver.verifyRequestSignature
 */
function createSlackSignature(signingSecret: string,  headers: Record<string, string>, bodyString: string) {
    // const slackSignature = getHeaderValue(context.headers, 'x-slack-signature');
    const timestamp = getHeaderValue(headers,'x-slack-request-timestamp');

    let sigBasestring = 'v0:' + timestamp + ':' + bodyString;

    const sig = 'v0=' +
        createHmac('sha256', signingSecret)
            .update(sigBasestring, 'utf8')
            .digest('hex');
    return sig;
}

function getHeaderValue(headers: StringIndexed, key: string) {
    const caseInsensitiveKey = Object.keys(headers).find((it) => key.toLowerCase() === it.toLowerCase());
    return caseInsensitiveKey !== undefined ? headers[caseInsensitiveKey] : undefined;
}

export function replaceHeaderValue(headers: StringIndexed, key: string, value: string) {
    const caseInsensitiveKey = Object.keys(headers).find((it) => key.toLowerCase() === it.toLowerCase());
    if (caseInsensitiveKey !== undefined) {
        headers[caseInsensitiveKey] = value;
    }
}