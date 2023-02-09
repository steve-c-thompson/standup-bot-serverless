#!/usr/bin/env ts-node-script

import {DataMapper} from "@aws/dynamodb-data-mapper";
import {context, logger, standupStatusTableName} from "../../utils/context";
import {StandupStatus} from "../../data/StandupStatus";

export const jan1 = new Date(2020, 0, 1);
export const jan2 = new Date(2020, 0, 2);

export async function createStandupStatus() {
    const client = context.dynamoDbClient;
    const mapper = new DataMapper({client: client, tableNamePrefix: context.tableNamePrefix});
    // drop and recreate the table
    try {
        await mapper.ensureTableNotExists(StandupStatus);
        await mapper.ensureTableExists(StandupStatus, {
            readCapacityUnits: 5,
            writeCapacityUnits: 5
        });
        logger.info(`Dynamo table ${context.tableNamePrefix + standupStatusTableName} created`);
    } catch (e) {
        console.error("Error creating Dynamo table", e);
    }
}

export async function createDynamodb() {
    await createStandupStatus();
}

if (require.main === module) {
    createDynamodb();
}