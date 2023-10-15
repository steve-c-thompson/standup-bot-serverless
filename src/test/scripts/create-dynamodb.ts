#!/usr/bin/env ts-node-script

import {
  appContext,
  standupStatusTableName,
} from "../../utils/appContext.js";
import * as url from "node:url";

export const jan1 = new Date(2020, 0, 1);
export const jan2 = new Date(2020, 0, 2);

export async function createStandupStatus() {
  // drop and recreate the table
  const table = appContext.tableNamePrefix + standupStatusTableName;
  try {
    await ensureTableNotExists(table);
    await ensureTableExists(table);

    // logger.info(`Dynamo table ${table} created`);
  } catch (e) {
    console.error("Error creating Dynamo table", e);
  }
}

export async function createDynamodb() {
  await createStandupStatus();
  // await hydrate();
}

// Must include this here or move calculation of caller somehow.
function requireMain(callback: () => void): void {
  if (import.meta.url.startsWith("file:")) {
    const modulePath = url.fileURLToPath(import.meta.url);
    if (process.argv[1] === modulePath) {
      callback();
    }
  }
}

requireMain(createDynamodb);

import {
  CreateTableCommand,
  DescribeTableCommand,
  DeleteTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import {
  customMarshall, translateConfig
} from "../../utils/aws/marshall.js";
import { StandupStatus } from "../../data/StandupStatus.js";

async function ensureTableExists(tableName: string) {
  try {
    await appContext.dynamoDbClient.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    // console.log(`Table ${tableName} exists.`);
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      // console.log(`Table ${tableName} does not exist. Creating...`);
      await appContext.dynamoDbClient.send(
        new CreateTableCommand({
          TableName: tableName,
          AttributeDefinitions: [
            { AttributeName: "id", AttributeType: "S" },
            { AttributeName: "userId", AttributeType: "S" },
            // Add other attribute definitions as needed
          ],
          KeySchema: [
            { AttributeName: "id", KeyType: "HASH" },
            { AttributeName: "userId", KeyType: "RANGE" },
            // Add other key schema elements as needed
          ],
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
          GlobalSecondaryIndexes: [
            {
              IndexName: "userId-index",
              KeySchema: [
                { AttributeName: "userId", KeyType: "HASH" },
                // Add other key schema elements as needed
              ],
              Projection: {
                ProjectionType: "ALL",
              },
              ProvisionedThroughput: {
                ReadCapacityUnits: 1,
                WriteCapacityUnits: 1,
              },
            },
          ],
        })
      );

      // Wait for table to be active
      while (true) {
        const { Table } = await appContext.dynamoDbClient.send(
          new DescribeTableCommand({ TableName: tableName })
        );
        if (Table?.TableStatus === "ACTIVE") {
          // console.log(`Table ${tableName} created successfully.`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000)); // wait for 5 seconds before checking again
      }
    } else {
      throw error;
    }
  }
}

async function ensureTableNotExists(tableName: string) {
  try {
    await appContext.dynamoDbClient.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    // console.log(`Table ${tableName} exists. Deleting...`);
    await appContext.dynamoDbClient.send(
      new DeleteTableCommand({ TableName: tableName })
    );

    // Wait for table to be deleted
    while (true) {
      try {
        await appContext.dynamoDbClient.send(
          new DescribeTableCommand({ TableName: tableName })
        );
      } catch (error: any) {
        if (error.name === "ResourceNotFoundException") {
          // console.log(`Table ${tableName} deleted successfully.`);
          break;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000)); // wait for 5 seconds before checking again
    }
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      // console.log(`Table ${tableName} does not exist.`);
    } else {
      throw error;
    }
  }
}

async function hydrate() {
  const jan1Zero = new Date(jan1.getTime());
  jan1Zero.setUTCHours(0, 0, 0, 0);
  const jan2Zero = new Date(jan2.getTime());
  jan2Zero.setUTCHours(0, 0, 0, 0);

  const tzOffset = -420; // 7 hours behind UTC
  const jan1ElevenPmTz = new Date(jan2Zero.getTime() + 6 * 60 * 60 * 1000);
  const statusDave: StandupStatus = new StandupStatus({
    id: "ABC#" + jan2Zero.getTime(),
    channelId: "ABC",
    standupDate: jan2Zero,
    userTimezoneOffset: tzOffset,
    userId: "Dave",
    statusMessages: [
      {
        messageType: "scheduled",
        today: "today",
        yesterday: "yesterday",
        parkingLot: "parking lot",
        parkingLotAttendees: ["Mike", "Peter", "Davy"],
        pullRequests: "pull requests",
        scheduleDateStr: "10/20/2020",
        scheduleTimeStr: "09:08",
        messageId: "99999",
        messageDate: jan1ElevenPmTz,
        userId: "Dave",
        channelId: "ABC",
      },
    ],
    timeToLive: jan2Zero,
  });
  saveStatus(statusDave);
}
export async function saveStatus(status: StandupStatus) {
  const ddbDocClient = DynamoDBDocumentClient.from(
    appContext.dynamoDbClient,
    translateConfig
  );

  const table = appContext.tableNamePrefix + standupStatusTableName;
  // console.log("Saving", JSON.stringify(status));
  const c = customMarshall(status);
  // console.log("marshalled", JSON.stringify(c));
  await ddbDocClient.send(
    new PutCommand({
      TableName: table,
      Item: c,
    })
  );

  // const { Items } = await ddbDocClient.send(
  //   new QueryCommand({
  //     TableName: table,
  //     IndexName: "userId-index",
  //     KeyConditionExpression: "#userId = :userId",
  //     ExpressionAttributeNames: {
  //       "#userId": "userId",
  //     },
  //     ExpressionAttributeValues: {
  //       ":userId": status.userId,
  //     },
  //     ScanIndexForward: true,
  //   })
  // );

  // const statuses: StandupStatus[] = Items?.map((i) =>
  //   customUnmarshall(i, StandupStatus)
  // ) as StandupStatus[];

  // console.log("Found", JSON.stringify(statuses));
  // console.log(statuses[0].createdAt);
}
