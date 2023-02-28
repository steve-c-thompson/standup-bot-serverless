import * as AWS from "aws-sdk";
import {DynamoDB} from "aws-sdk";
import {SecretsManager} from "@aws-sdk/client-secrets-manager";
import {AwsSecretsDataSource} from "../secrets/AwsSecretsDataSource";
import {ConsoleLogger} from "@slack/logger";

export type SecretName = "SlackStandup-secret-prod" | "SlackStandup-secret-dev";
export const standupStatusTableName = "STANDUP_STATUS";
export type DynamoTableNamePrefix = "dev_" | "prod_" | "local_";

export const logger = new ConsoleLogger()

export const appContext = isLocal() ? createLocalContext() : isDev()? createDevContext() : createContext();

export interface Context {
    secretsManager? : SecretsManager;
    secretName: SecretName;
    dynamoDbClient: DynamoDB;
    tableNamePrefix: DynamoTableNamePrefix
}

function createContext(): Context {
    logger.info("Creating appContext for prod");
    // If you want a lot of logging...
    // AWS.config.update({
    //    logger: console
    // });
    return {
        secretName: "SlackStandup-secret-prod",
        dynamoDbClient: new DynamoDB({}),
        tableNamePrefix: "prod_",
    };
}

function createDevContext(): Context {
    logger.info("Creating appContext for dev");
    AWS.config.update({
        logger: console
    });
    return {
        secretName: "SlackStandup-secret-dev",
        dynamoDbClient: new DynamoDB({}),
        tableNamePrefix: "dev_",
    };
}

function isLocal(): boolean {
    return process.env.stage === "local";
}

function isDev(): boolean {
    return process.env.stage === "dev";
}

function createLocalContext(): Context {
    logger.info("Creating appContext for local");
    AWS.config.update({
        accessKeyId: "not-a-real-access-key-id",
        secretAccessKey: "not-a-real-access-key",
        region: "us-west-2",
        // Uncomment to see localstack calls in the console
        // logger: console,
    });

    return {
        secretsManager: new SecretsManager({
            endpoint: "http://localhost:4566",
            credentials: {
                accessKeyId: AWS.config.credentials?.accessKeyId!,
                secretAccessKey: AWS.config.credentials?.secretAccessKey!
            },
            region: AWS.config.region,
        }),
        secretName: "SlackStandup-secret-dev",
        dynamoDbClient: new DynamoDB({
            endpoint: "http://localhost:4566",
            credentials: {
                accessKeyId: AWS.config.credentials?.accessKeyId!,
                secretAccessKey: AWS.config.credentials?.secretAccessKey!
            },
            region: AWS.config.region,
        }),
        tableNamePrefix: "local_",
    };
}

export async function getSecretValue(sm: SecretsManager, secretName : string) {
    try {
        const data = await sm.getSecretValue(({
            SecretId: secretName
        }));

        if(data) {
            if (data.SecretString) {
                const secret = data.SecretString;
                const parsedSecret = JSON.parse(secret);
                return parsedSecret;
            }
            else {
                let buff = new Buffer(data.SecretBinary!);
                return buff.toString('ascii');
            }
        }
    }
    catch (e) {
        logger.error('Error retrieving secrets', e);
        throw e;
    }
    return undefined;
}

export const dataSource = new AwsSecretsDataSource(appContext.secretsManager!);
export const blockId = new RegExp("change-msg-.*");