import * as AWS from "aws-sdk";
import {DynamoDB} from "aws-sdk";
import {LambdaClient} from "@aws-sdk/client-lambda";
import {SecretsManager} from "@aws-sdk/client-secrets-manager";
// import winston, {createLogger, Logger} from "winston";
import {AwsSecretsDataSource} from "../secrets/AwsSecretsDataSource";
import {LogLevel} from "@slack/bolt";
import {ConsoleLogger} from "@slack/logger";

export type SecretName = "SlackStandup-secret-prod" | "SlackStandup-secret-dev";
export const standupStatusTableName = "STANDUP_STATUS";
export type DynamoTableNamePrefix = "dev_" | "prod_" | "local_";

// export const logger = createLogger( {
//     level: 'info',
//     format: winston.format.simple(),
//     transports: [
//         new winston.transports.Console()
//     ]
// });

export const logger = new ConsoleLogger()

export const context = isLocal() ? createLocalContext() : isDev()? createDevContext() : createContext();

export interface Context {
    secretsManager : SecretsManager;
    secretName: SecretName;
    dynamoDbClient: DynamoDB;
    tableNamePrefix: DynamoTableNamePrefix
    lambdaClient: LambdaClient;
}

function createContext(): Context {
    logger.info("Creating context for prod");
    return {
        secretsManager: new SecretsManager({}),
        secretName: "SlackStandup-secret-prod",
        dynamoDbClient: new DynamoDB({}),
        tableNamePrefix: "prod_",
        lambdaClient: new LambdaClient({})
    };
}

function createDevContext(): Context {
    logger.info("Creating context for dev");
    return {
        secretsManager: new SecretsManager({}),
        secretName: "SlackStandup-secret-dev",
        dynamoDbClient: new DynamoDB({}),
        tableNamePrefix: "dev_",
        lambdaClient: new LambdaClient({})
    };
}

function isLocal(): boolean {
    return process.env.stage === "local";
}

function isDev(): boolean {
    return process.env.stage === "dev";
}

function createLocalContext(): Context {
    logger.info("Creating context for local");
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
        lambdaClient: new LambdaClient({
            endpoint: "http://localhost:3002",
            credentials: {
                accessKeyId: AWS.config.credentials?.accessKeyId!,
                secretAccessKey: AWS.config.credentials?.secretAccessKey!
            },
            logger: console,
            region: AWS.config.region,
        })
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
        console.log('Error retrieving secrets');
        console.log(e);
    }
    return undefined;
}

export const dataSource = new AwsSecretsDataSource(context.secretsManager);
export const blockId = new RegExp("change-msg-.*");