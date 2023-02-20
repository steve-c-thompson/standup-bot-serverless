import {SecretsManager} from "@aws-sdk/client-secrets-manager";
import {SlackSecret, SecretDataSource} from "./SecretDataSource";
import {appContext, getSecretValue, logger} from "../utils/appContext";

export class AwsSecretsDataSource implements SecretDataSource{
    secretsManager: SecretsManager;
    constructor(sm : SecretsManager) {
        this.secretsManager = sm;
    }

    async buildSecretPromise(secretToken: string) : Promise<string> {
        // logger.debug("Fetching secretToken " + secretToken + " from secret named " + appContext.secretName);
        return new Promise((resolve, reject) => {
            let sp = getSecretValue(this.secretsManager, appContext.secretName);
            sp.then((sec) => {
                if(sec) {
                    // Ugly casting to get the secret into correct format
                    const secCast = sec as unknown as SlackSecret;
                    const val = secCast[secretToken as keyof SlackSecret];
                    resolve(val);
                }
                else {
                    reject(`Secret ${secretToken} not found`);
                }
            }).catch((reason) => {
                logger.error(`Error fetching ${secretToken}: `, reason);
                reject(reason);
            });
        });
    }

    slackSigningSecret() {
        return this.buildSecretPromise("SLACK_STANDUP_SIGNING_SECRET");
    }
    slackToken() {
        return this.buildSecretPromise("SLACK_STANDUP_BOT_TOKEN");
    }

}