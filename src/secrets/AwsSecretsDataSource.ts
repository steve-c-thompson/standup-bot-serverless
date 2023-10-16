import {GetSecretValueCommandOutput, SecretsManager} from "@aws-sdk/client-secrets-manager";
import {SlackSecret, SecretDataSource, SecretKey} from "./SecretDataSource";
import {appContext, logger} from "../utils/appContext";

const AWS_SECRETS_EXTENSION_HTTP_PORT = 2773;
const AWS_SECRETS_EXTENSION_SERVER_ENDPOINT = `http://localhost:${AWS_SECRETS_EXTENSION_HTTP_PORT}/secretsmanager/get?secretId=`;

export class AwsSecretsDataSource implements SecretDataSource{
    secretsManager: SecretsManager;
    constructor(sm: SecretsManager) {
        this.secretsManager = sm;
    }

    async buildSecretPromise(secretToken: SecretKey) : Promise<string> {
        logger.debug("Fetching secretToken " + secretToken + " from secret named " + appContext.secretName);

        const result = await this.secretsManager.getSecretValue({SecretId: appContext.secretName});
        return this.parseSecretForToken(result, secretToken);
    }

    private parseSecretForToken(result: GetSecretValueCommandOutput, secretToken: string) {
        if (result.SecretString) {
            const secret = JSON.parse(result.SecretString) as SlackSecret;
            const val = secret[secretToken as keyof SlackSecret];
            if (!val) {
                throw new Error(`Secret ${secretToken} not found`);
            }
            logger.debug("Found secretToken " + secretToken + ", adding to cache");
            return val
        }
        else {
            throw new Error(`Secret ${secretToken} not found`);
        }
    }

    async slackSigningSecret() {
        const s = "SLACK_STANDUP_SIGNING_SECRET";
        return this.selectLocalOrLayerSecret(s);
    }
    async slackToken() {
        const s = "SLACK_STANDUP_BOT_TOKEN"
        return this.selectLocalOrLayerSecret(s);
    }

    private async selectLocalOrLayerSecret(s: SecretKey) {
        // if(appContext.isLocalContext())
            return this.buildSecretPromise(s);
        // else
        //     return this.getLayerSecretValue(s);
    }

    private async getLayerSecretValue (secretName: string) {
        const url = `${AWS_SECRETS_EXTENSION_SERVER_ENDPOINT}${appContext.secretName}`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "X-Aws-Parameters-Secrets-Token": process.env.AWS_SESSION_TOKEN!,
          },
        });
      
        if (!response.ok) {
            const len = process.env.AWS_SESSION_TOKEN?.length ?? 0;
          throw new Error(
            `Error occured while requesting secret ${secretName} from url ${url} using token with length ${len}. Responses status was ${response.status} with headers ${JSON.stringify(response.headers)} and status text ${response.statusText} and body ${JSON.stringify(response.body)}`
          );
        }
        logger.info(`Retrieving secret ${secretName} from Layer`);
        const secretContent = (await response.json()) as GetSecretValueCommandOutput;
        return this.parseSecretForToken(secretContent, secretName);
      }

}