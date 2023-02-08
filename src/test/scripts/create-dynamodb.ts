#!/usr/bin/env ts-node-script

import {DataMapper} from "@aws/dynamodb-data-mapper";
import {StandupParkingLotData} from "../../data/StandupParkingLotData";
import {context, standupParkingLotTableName, logger, standupStatusTableName} from "../../utils/context";
import {DynamoDbStandupParkingLotDataDao} from "../../data/DynamoDbStandupParkingLotDataDao";
import {StandupStatus} from "../../data/StandupStatus";

export const jan1 = new Date(2020, 0, 1);
export const jan2 = new Date(2020, 0, 2);

export const testParkingLotData = DynamoDbStandupParkingLotDataDao.objectFactory("ABC",
    jan1,
    [
        {
            attendees: ["Dave", "Bobby"],
            userId: "Ricky",
            content: "Some content"
        },
        {
            attendees: ["Jenny", "Samara"],
            userId: "Sarah",
            content: "Some more content"
        }
    ],

);

export async function createStandupParkingLotData() {
    const client = context.dynamoDbClient;
    const mapper = new DataMapper({client: client, tableNamePrefix: context.tableNamePrefix});
    // drop and recreate the table
    try {
        await mapper.ensureTableNotExists(StandupParkingLotData);
        await mapper.ensureTableExists(StandupParkingLotData, {
            readCapacityUnits: 5,
            writeCapacityUnits: 5
        });
        logger.info(`Dynamo table ${context.tableNamePrefix + standupParkingLotTableName} created`);
        const saved = await mapper.put(testParkingLotData);
        // console.log("Saved preloaded data " + JSON.stringify(saved));
    } catch (e) {
        console.error("Error creating Dynamo table", e);
    }
}

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
    await createStandupParkingLotData();
    await createStandupStatus();

}

if (require.main === module) {
    createDynamodb();
}