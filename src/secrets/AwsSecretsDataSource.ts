import {SecretsManager} from "@aws-sdk/client-secrets-manager";
import {SlackSecret, SecretDataSource} from "./SecretDataSource";
import {appContext, getSecretValue, logger} from "../utils/appContext";

export class AwsSecretsDataSource implements SecretDataSource{
    secretsManager?: SecretsManager;
    constructor(sm?: SecretsManager) {
        this.secretsManager = sm;
    }

    async buildSecretPromise(secretToken: string) : Promise<string> {
        logger.info("Fetching secretToken " + secretToken + " from secret named " + appContext.secretName);
        // If there is no secrets manager defined, create a new one to avoid invalid signatures
        const sm: SecretsManager = this.secretsManager ? this.secretsManager : new SecretsManager({});

        return new Promise((resolve, reject) => {
            let sp = getSecretValue(sm, appContext.secretName);
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

    async slackSigningSecret() {
        return this.buildSecretPromise("SLACK_STANDUP_SIGNING_SECRET");
    }
    async slackToken() {
        return this.buildSecretPromise("SLACK_STANDUP_BOT_TOKEN");
    }

}