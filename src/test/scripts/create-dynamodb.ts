#!/usr/bin/env ts-node-script

import {DataMapper} from "@aws/dynamodb-data-mapper";
import {StandupParkingLotData} from "../../data/StandupParkingLotData";
import {context, standupParkingLotTableName} from "../../utils/context";
import {DynamoDbStandupParkingLotDataDao} from "../../data/DynamoDbStandupParkingLotDataDao";

export const jan1 = new Date(2020, 0, 1);
export const jan2 = new Date(2020, 0, 2);

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
        console.log(`Dynamo table ${context.tableNamePrefix + standupParkingLotTableName} created`);
    } catch (e) {
        console.error("Error creating Dynamo table", e);
    }

    const d = DynamoDbStandupParkingLotDataDao.standupParkingLotDataObjectFactory("ABC",
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
    const saved = await mapper.put(d);
    console.log("Saved preloaded data " + JSON.stringify(saved));
}

if (require.main === module) {
    createDynamodb();
}