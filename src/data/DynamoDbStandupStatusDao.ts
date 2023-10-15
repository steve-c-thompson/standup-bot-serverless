import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { StandupStatusDao } from "./StandupStatusDao.js";
import { StandupStatus, StatusMessage } from "./StandupStatus.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createZeroUtcDate } from "../utils/datefunctions.js";
import {
  appContext,
  logger,
  standupStatusTableName,
} from "../utils/appContext";
import {
  customMarshall,
  customUnmarshall,
  translateConfig,
} from "../utils/aws/marshall";

export class DynamoDbStandupStatusDao implements StandupStatusDao {
  private readonly ddbDocClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(client: DynamoDBClient) {
    this.ddbDocClient = DynamoDBDocumentClient.from(client, translateConfig);
    this.tableName = appContext.tableNamePrefix + standupStatusTableName;
  }

  /**
     * Get all data for this channel and date, return empty array if none found.
     * @param channelId
     * @param date
     * @param timezoneOffset
     */
  async getChannelDataForDate(
    channelId: string,
    date: Date,
    timezoneOffset: number
  ): Promise<StandupStatus[]> {
    date = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffset);
    const id = this.buildId(channelId, date);

    const { Items } = await this.ddbDocClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "#id = :id",
        ExpressionAttributeNames: {
          "#id": "id",
        },
        ExpressionAttributeValues: {
          ":id": id,
        },
      })
    );

    return Items?.map((i) =>
      customUnmarshall(i, StandupStatus)
    ) as StandupStatus[];
  }

  /**
     * Get channel data for this channel and date, for this specific user. Return null if not found.
     * @param channelId
     * @param date a date in local timezone. The timezone offset will be used to calculate the date in UTC
     * @param userId
     * @param timezoneOffset
     */
  async getChannelData(
    channelId: string,
    date: Date,
    userId: string,
    timezoneOffset: number
  ): Promise<StandupStatus | null> {
    const calDate = this.calibrateStandupDateFromTimezoneOffset(
      date,
      timezoneOffset
    );
    const id = this.buildId(channelId, calDate);
    try {
      const { Item } = await this.ddbDocClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { id, userId },
        })
      );
      // console.log("Retrieved item is", JSON.stringify(Item));
      
      return customUnmarshall(Item, StandupStatus) as StandupStatus;
    } catch {
      return null;
    }
  }
  async getStandupStatusesByUserId(
    userId: string,
    standupDateAfter?: Date | undefined,
    timezoneOffset?: number | undefined
  ): Promise<StandupStatus[]> {
    let calDate: Date | undefined = undefined;
    if (standupDateAfter && timezoneOffset) {
      calDate = this.calibrateStandupDateFromTimezoneOffset(
        standupDateAfter,
        timezoneOffset
      );
      calDate = createZeroUtcDate(calDate); // Zero the date for searching
    }
    logger.debug(
      `Getting standup statuses for user ${userId} after date ${calDate?.toISOString()} with timezone offset ${timezoneOffset}`
    );

    const { Items } = await this.ddbDocClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "userId-index",
        KeyConditionExpression: "#userId = :userId",
        ExpressionAttributeNames: {
          "#userId": "userId",
        },
        ExpressionAttributeValues: {
          ":userId": userId,
        },
        ScanIndexForward: true,
      })
    );

    let arr = (
      Items?.map((i) => {
        return customUnmarshall(i, StandupStatus);
      }) as StandupStatus[]
    );

    // console.log("Arr is", JSON.stringify(arr));

    // Filter out any empty objects
    arr = arr.filter((s) => s.standupDate && (!calDate || s.standupDate.getTime() >= calDate.getTime()));
    return arr;
  }
  async getStatusMessage(
    userId: string,
    messageId: string
  ): Promise<StatusMessage | undefined> {
    const standupStatuses = await this.getStandupStatusesByUserId(userId);
    return standupStatuses
      .find((s) => s.statusMessages.some((m) => m.messageId === messageId))
      ?.statusMessages.find((m) => m.messageId === messageId);
  }

   /**
     * Add a status message to the channel data for this channel and date, for this specific user.
     * If no data exists for this channel and date, create it.
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     * @param timezoneOffset
     */
  async addStatusMessage(
    channelId: string,
    standupDate: Date,
    userId: string,
    data: StatusMessage,
    timezoneOffset: number
  ): Promise<StandupStatus> {
    const status = await this.getChannelData(
      channelId,
      standupDate,
      userId,
      timezoneOffset
    );
    if (status) {
      // ensure consistency
      data.userId = userId;
      data.channelId = channelId;
      const i = status.statusMessages.findIndex(
        (m) => m.messageId === data.messageId
      );
      if (i > -1) {
        // found message, replacing
        logger.info(
          `Replacing status message for user ${userId} in channel ${channelId} for date ${standupDate.toISOString()} with messageId ${
            data.messageId
          }`
        );
        status.statusMessages[i] = data;
      } else {
        status.statusMessages.push(data);
        logger.info(
          `Adding status message to existing status for user ${userId} in channel ${channelId} for date ${standupDate.toISOString()}`
        );
      }

      await this.save(status);

      return status;
    } else {
      const newStatus = new StandupStatus({
        statusMessages: [data],
      });

      return await this.putData(
        channelId,
        standupDate,
        userId,
        newStatus,
        timezoneOffset
      );
    }
  }

  private async save(status: StandupStatus) {
    await this.ddbDocClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: customMarshall(status),
      })
    );
  }

  /**
     * Remove data for this channel, date, and user
     * @param channelId
     * @param date
     * @param userId
     * @param timezoneOffset
     */
  async removeStandupStatus(
    channelId: string,
    date: Date,
    userId: string,
    timezoneOffset: number
  ): Promise<StandupStatus | undefined> {
    date = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffset);
    const id = this.buildId(channelId, date);

    const { Attributes } = await this.ddbDocClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { id, userId },
        ReturnValues: "ALL_OLD",
      })
    );

    return Attributes as StandupStatus;
  }

  /**
     * Remove a single message from the standups status for a user. If all messages are removed
     * the status is removed.
     * @param userId
     * @param messageId
     */
  async removeStandupStatusMessageByUserIdAndMessageId(
    userId: string,
    messageId: string
  ): Promise<StandupStatus | undefined> {
    const statuses = await this.getStandupStatusesByUserId(userId);
    // Filter for the status with the message ID, remove the message, update the status and return it
    const status = statuses.find((s) =>
      s.statusMessages.some((m) => m.messageId === messageId)
    );

    if (status) {
      status.statusMessages = status.statusMessages.filter(
        (m) => m.messageId !== messageId
      );

      if (status.statusMessages.length === 0) {
        // No messages left, remove the status, but return the whole thing with statuses
        const { Attributes } = await this.ddbDocClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: { id: status.id, userId },
            ReturnValues: "ALL_OLD",
          })
        );

        const stat = customUnmarshall(Attributes, StandupStatus) as StandupStatus;
        stat!.statusMessages = [];
        return stat;
      }

      await this.save(status);

      return status;
    }

    return undefined;
  }

  /**
     * Add data to database, ensuring that standupDate is UTC midnight, and TTL is 2 days past that
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     * @param timezoneOffset
     */
  async putData(
    channelId: string,
    standupDate: Date,
    userId: string,
    data: StandupStatus,
    timezoneOffset: number
  ): Promise<StandupStatus> {
    data.channelId = channelId;
    data.standupDate = standupDate;
    data.userId = userId;
    data.userTimezoneOffset = timezoneOffset;
    data.statusMessages.forEach((m) => {
      m.userId = userId;
      m.channelId = channelId;
    });
    this.validateAndSetDates(data, timezoneOffset);
    this.setIdfromChannelIdAndDate(data);

    await this.save(data);

    return data;
  }

  /**
     * Update an object. Without a channelId, standupDate, and userId, we can't update the ID, so we need to pass it in.
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     * @param timezoneOffset
     */
  async updateData(
    channelId: string,
    standupDate: Date,
    userId: string,
    data: StandupStatus,
    timezoneOffset: number
  ): Promise<StandupStatus> {
    data.channelId = channelId;
    data.standupDate = standupDate;
    data.userId = userId;
    data.updatedAt = new Date();
    data.statusMessages.forEach((m) => {
      m.userId = userId;
      m.channelId = channelId;
    });
    this.validateAndSetDates(data, timezoneOffset);
    this.setIdfromChannelIdAndDate(data);

    await this.save(data);

    return data;
  }

  private buildId(channelId: string, date: Date) {
    const d = createZeroUtcDate(date);
    return channelId + "#" + d.getTime();
  }

  private validateAndSetDates(data: StandupStatus, timezoneOffset: number) {
    if (!data.standupDate) {
      data.standupDate = new Date();
    }
    logger.debug(
      "standupDate before calibrate: " +
        data.standupDate +
        " timezoneOffset: " +
        timezoneOffset
    );
    data.standupDate = this.calibrateStandupDateFromTimezoneOffset(
      data.standupDate,
      timezoneOffset
    );
    logger.debug("standupDate after calibrate: " + data.standupDate);
    // Now zero out the time, so that we can use it as a partition key
    data.standupDate = createZeroUtcDate(data.standupDate);
    logger.debug("standupDate after zeroing: " + data.standupDate);
    data.timeToLive = new Date(data.standupDate!);
    data.timeToLive.setDate(data.standupDate!.getDate() + 2);
  }

  /**
   * Calibrate the standup date from the timezone offset. This is because the date might be the next day in UTC, but we want to use the local date.
   * @param date a moment in epoch time
   * @param timezoneOffset the timezone offset in minutes
   * @private
   */
  private calibrateStandupDateFromTimezoneOffset(
    date: Date,
    timezoneOffset: number
  ): Date {
    const calDate = new Date(date.getTime());
    calDate.setMinutes(calDate.getMinutes() + timezoneOffset);
    return calDate;
  }

  private setIdfromChannelIdAndDate(data: StandupStatus) {
    data.id = this.buildId(data.channelId, data.standupDate);
  }
}
