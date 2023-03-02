import {SecretsManager} from "@aws-sdk/client-secrets-manager";
import {SlackSecret, SecretDataSource, SecretKey} from "./SecretDataSource";
import {appContext, logger} from "../utils/appContext";

export class AwsSecretsDataSource implements SecretDataSource{
    secretsManager: SecretsManager;
    constructor(sm: SecretsManager) {
        this.secretsManager = sm;
    }

    async buildSecretPromise(secretToken: SecretKey) : Promise<string> {
        logger.info("Fetching secretToken " + secretToken + " from secret named " + appContext.secretName);

        const result = await this.secretsManager.getSecretValue({SecretId: appContext.secretName});
        if(result.SecretString) {
            const secret = JSON.parse(result.SecretString) as SlackSecret;
            const val = secret[secretToken as keyof SlackSecret];
            if(!val) {
                throw new Error(`Secret ${secretToken} not found`);
            }
            logger.info("Found secretToken " + secretToken + ", adding to cache");
            return val;
        }
        else {
            throw new Error(`Secret ${secretToken} not found`);
        }
    }

    async slackSigningSecret() {
        return this.buildSecretPromise("SLACK_STANDUP_SIGNING_SECRET");
    }
    async slackToken() {
        return this.buildSecretPromise("SLACK_STANDUP_BOT_TOKEN");
    }

}