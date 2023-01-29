#!/usr/bin/env ts-node-script
import {
    CreateSecretCommand,
    ListSecretsCommand,
    UpdateSecretCommand
} from "@aws-sdk/client-secrets-manager";
import {context} from "../../utils/context";
import * as dotenv from 'dotenv';

export async function createSecretsFromEnv() {
    dotenv.config();
    const secretName = context.secretName;

    const secretString = `{"SLACK_STANDUP_SIGNING_SECRET": "${process.env.SLACK_STANDUP_SIGNING_SECRET}" ,"SLACK_STANDUP_BOT_TOKEN": "${process.env.SLACK_STANDUP_BOT_TOKEN}"}`;

    const client = context.secretsManager;

    // See if secret exists
    const listSecrets = new ListSecretsCommand({});
    const secrets = await client.send(listSecrets);

    const foundSecret = secrets.SecretList?.find(s => s.Name === secretName);
    let command : CreateSecretCommand | UpdateSecretCommand;
    if(foundSecret) {
        console.log("Updating secret " + secretName);
        command = new UpdateSecretCommand({
            SecretId: foundSecret.ARN,
            SecretString: secretString
        });
        const response = await client.send(command);
        // console.log(response);
    }
    else {
        console.log("Creating new secret " + secretName);
        command = new CreateSecretCommand({
            Name: secretName,
            SecretString: secretString
        });
        const response = await client.send(command);
        console.log(response);
    }
}

if (require.main === module) {
    createSecretsFromEnv();
}