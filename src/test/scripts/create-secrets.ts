#!/usr/bin/env ts-node-script
import {
    CreateSecretCommand,
    ListSecretsCommand,
    UpdateSecretCommand
} from "@aws-sdk/client-secrets-manager";
import {appContext, logger} from "../../utils/appContext.js";
import * as dotenv from 'dotenv';
import * as url from 'node:url';

/**
 * This script will create a secret in localstack's Secrets Manager
 */
export async function createSecretsFromEnv() {
    // dotenv allows using the .env file
    dotenv.config();
    const secretName = appContext.secretName;

    if(!process.env.SLACK_STANDUP_SIGNING_SECRET || !process.env.SLACK_STANDUP_BOT_TOKEN){
        throw new Error("Missing environment variables. Be sure you have created a .env file");
    }

    const secretString = `{"SLACK_STANDUP_SIGNING_SECRET": "${process.env.SLACK_STANDUP_SIGNING_SECRET}" ,"SLACK_STANDUP_BOT_TOKEN": "${process.env.SLACK_STANDUP_BOT_TOKEN}"}`;
    const client = appContext.secretsManager;

    // See if secret exists
    const listSecrets = new ListSecretsCommand({});
    const secrets = await client.send(listSecrets);

    const foundSecret = secrets.SecretList?.find(s => s.Name === secretName);
    let command : CreateSecretCommand | UpdateSecretCommand;
    if(foundSecret) {
        console.debug("Updating secret " + secretName);
        command = new UpdateSecretCommand({
            SecretId: foundSecret.ARN,
            SecretString: secretString
        });
        const response = await client.send(command);
        logger.debug(response);
    }
    else {
        console.debug("Creating new secret " + secretName);
        command = new CreateSecretCommand({
            Name: secretName,
            SecretString: secretString
        });
        const response = await client.send(command);
        logger.debug(response);
    }
    logger.debug("Secret created successfully");
}

// Must include this here or move calculation of caller somehow.
function requireMain(callback: () => void): void {
    if (import.meta.url.startsWith('file:')) { // (A)
        const modulePath = url.fileURLToPath(import.meta.url);
        if (process.argv[1] === modulePath) { // (B)
          // Main ESM module
          callback();
        }
    }
  }
requireMain(createSecretsFromEnv);