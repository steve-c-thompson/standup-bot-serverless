#!/usr/bin/env ts-node-script

import {DataMapper} from "@aws/dynamodb-data-mapper";
import {StandupParkingLotData} from "../../data/StandupParkingLotData";
import {context, standupParkingLotTableName, logger} from "../../utils/context";
import {DynamoDbStandupParkingLotDataDao} from "../../data/DynamoDbStandupParkingLotDataDao";

export const jan1 = new Date(2020, 0, 1);
export const jan2 = new Date(2020, 0, 2);

export const testParkingLotData = DynamoDbStandupParkingLotDataDao.standupParkingLotDataObjectFactory("ABC",
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
export async function createDynamodb() {
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
    } catch (e) {
        console.error("Error creating Dynamo table", e);
    }


    const saved = await mapper.put(testParkingLotData);
    console.log("Saved preloaded data " + JSON.stringify(saved));
}

export async function dbCleanup() {
    return createDynamodb();
}

if (require.main === module) {
    createDynamodb();
}