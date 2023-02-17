import {StandupStatus, StatusMessage} from "./StandupStatus";
import {StandupStatusDao} from "./StandupStatusDao";
import {createZeroUtcDate} from "../utils/datefunctions";
import {DynamoDB} from "aws-sdk";
import {DataMapper, QueryIterator} from "@aws/dynamodb-data-mapper";
import {context, logger} from "../utils/context";

export class DynamoDbStandupStatusDao implements StandupStatusDao {
    private readonly client: DynamoDB;
    private readonly mapper: DataMapper;

    constructor(client: DynamoDB) {
        this.client = client;
        this.mapper = new DataMapper(
            {client: client, tableNamePrefix: context.tableNamePrefix}
        );
    }

    /**
     * Get channel data for this channel and date, for this specific user. Return null if not found.
     * @param channelId
     * @param date a date in local timezone. The timezone offset will be used to calculate the date in UTC
     * @param userId
     * @param timezoneOffset
     */
    async getChannelData(channelId: string, date: Date, userId: string, timezoneOffset: number): Promise<StandupStatus | null> {
        let calDate = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffset);
        const id = this.buildId(channelId, calDate);
        const toFetch = new StandupStatus({
            id: id,
            userId: userId
        });
        try {
            return await Promise.resolve(this.mapper.get(toFetch));
        } catch {
            return null;
        }
    }

    async getStandupStatusesByUserId(userId: string, standupDateAfter?: Date, timezoneOffset?: number): Promise<StandupStatus[]> {
        const query = {
            indexName: "userId-index",
            valueConstructor: StandupStatus,
            keyCondition: {
                userId: userId
            },
            scanIndexForward: true
        };
        const it: QueryIterator<StandupStatus> = await this.mapper.query(query);
        const arr = [];
        let calDate;
        if (standupDateAfter && timezoneOffset) {
            calDate = this.calibrateStandupDateFromTimezoneOffset(standupDateAfter, timezoneOffset);
            calDate = createZeroUtcDate(calDate);   // Zero the date for searching
        }
        logger.debug(`Getting standup statuses for user ${userId} after date ${calDate?.toISOString()} with timezone offset ${timezoneOffset}`);
        for await (const s of it) {
            if (calDate) {
                if (s.standupDate.getTime() >= calDate.getTime()) {
                    arr.push(s);
                }
            } else {
                arr.push(s);
            }
        }

        return arr;
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
    async addStatusMessage(channelId: string, standupDate: Date, userId: string, data: StatusMessage, timezoneOffset: number): Promise<StandupStatus> {
        const status = await this.getChannelData(channelId, standupDate, userId, timezoneOffset);
        if (status) {
            // ensure consistency
            data.userId = userId;
            data.channelId = channelId;
            const i = status.statusMessages.findIndex(m => m.messageId === data.messageId)
            if (i > -1) {
                // found message, replacing
                logger.info(`Replacing status message for user ${userId} in channel ${channelId} for date ${standupDate.toISOString()} with messageId ${data.messageId}`);
                status.statusMessages[i] = data;
            } else {
                status.statusMessages.push(data);
                logger.info(`Adding status message to existing status for user ${userId} in channel ${channelId} for date ${standupDate.toISOString()}`);
            }
            return await Promise.resolve(this.mapper.put(status));
        } else {
            const newStatus = new StandupStatus({
                statusMessages: [data],
            });
            return await this.putData(channelId, standupDate, userId, newStatus, timezoneOffset);
        }
    }

    async getStatusMessage(userId: string, messageId: string): Promise<StatusMessage | undefined> {
        const standupStatuses = await this.getStandupStatusesByUserId(userId);
        // Iterate through all statuses and find the one with the matching messageId
        return standupStatuses.find(s => {
            const found = s.statusMessages.filter(m => m.messageId === messageId);
            return found.length > 0;
        })?.statusMessages.find(m => m.messageId === messageId);
    }

    /**
     * Get all data for this channel and date, return empty array if none found.
     * @param channelId
     * @param date
     * @param timezoneOffset
     */
    async getChannelDataForDate(channelId: string, date: Date, timezoneOffset: number): Promise<StandupStatus[]> {
        date = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffset);
        const id = this.buildId(channelId, date);
        const it: QueryIterator<StandupStatus> = await this.mapper.query(StandupStatus, {
            id: id
        });
        const arr = [];
        for await (const s of it) {
            arr.push(s);
        }

        return arr;
    }

    /**
     * Add data to database, ensuring that standupDate is UTC midnight, and TTL is 1 day past that
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     * @param timezoneOffset
     */
    async putData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffset: number): Promise<StandupStatus> {
        data.channelId = channelId;
        data.standupDate = standupDate;
        data.userId = userId;
        data.userTimezoneOffset = timezoneOffset;
        // ensure we keep userId and channelId in sync
        data.statusMessages.forEach(m => {
           m.userId = userId;
           m.channelId = channelId;
        });
        this.validateAndSetDates(data, timezoneOffset);
        this.setIdfromChannelIdAndDate(data);
        return this.mapper.put(data);
    }

    /**
     * Update an object. Without a channelId, standupDate, and userId, we can't update the ID, so we need to pass it in.
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     * @param timezoneOffset
     */
    async updateData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffset: number): Promise<StandupStatus> {
        data.channelId = channelId;
        data.standupDate = standupDate;
        data.userId = userId;
        data.updatedAt = new Date();
        // ensure we keep userId and channelId in sync
        data.statusMessages.forEach(m => {
            m.userId = userId;
            m.channelId = channelId;
        });
        // ensure we keep the dates aligned
        this.validateAndSetDates(data, timezoneOffset);
        this.setIdfromChannelIdAndDate(data);
        return this.mapper.update(data, {onMissing: "skip"});
    }

    /**
     * Remove data for this channel, date, and user
     * @param channelId
     * @param date
     * @param userId
     * @param timezoneOffset
     */
    async removeStandupStatus(channelId: string, date: Date, userId: string, timezoneOffset: number): Promise<StandupStatus | undefined> {
        const d = new StandupStatus();
        date = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffset);
        d.id = this.buildId(channelId, date);
        d.userId = userId;
        return this.mapper.delete(d);
    }

    /**
     * Remove a single message from the standups status for a user. If all messages are removed
     * the status is removed.
     * @param userId
     * @param messageId
     */
    async removeStandupStatusMessageByUserIdAndMessageId(userId: string, messageId: string): Promise<StandupStatus | undefined> {
        const statuses = await this.getStandupStatusesByUserId(userId);
        // Filter for the status with the message ID, remove the message, update the status and return it
        const status = statuses.find(s => {
            const found = s.statusMessages.filter(m => m.messageId === messageId);
            return found.length > 0;
        });
        if (status) {
            status.statusMessages = status.statusMessages.filter(m => m.messageId !== messageId);
            if (status.statusMessages.length === 0) {
                // No messages left, remove the status, but return the whole thing with statuses
                const d = await this.mapper.delete(status);
                d!.statusMessages = [];
                return d;
            }
            return this.mapper.update(status, {onMissing: "skip"});
        }
        return undefined;
    }

    private buildId(channelId: string, date: Date) {
        const d = createZeroUtcDate(date);
        return channelId + "#" + d.getTime();
    }

    private validateAndSetDates(data: StandupStatus, timezoneOffset: number) {
        if (!data.standupDate) {
            data.standupDate = new Date();
        }
        logger.debug("standupDate before calibrate: " + data.standupDate + " timezoneOffset: " + timezoneOffset);
        data.standupDate = this.calibrateStandupDateFromTimezoneOffset(data.standupDate, timezoneOffset);
        logger.debug("standupDate after calibrate: " + data.standupDate);
        // Now zero out the time, so that we can use it as a partition key
        data.standupDate = createZeroUtcDate(data.standupDate);
        logger.debug("standupDate after zeroing: " + data.standupDate);
        data.timeToLive = new Date(data.standupDate!);
        data.timeToLive.setDate(data.standupDate!.getDate() + 1);
    }

    /**
     * Calibrate the standup date from the timezone offset. This is because the date might be the next day in UTC, but we want to use the local date.
     * @param date a moment in epoch time
     * @param timezoneOffset the timezone offset in minutes
     * @private
     */
    private calibrateStandupDateFromTimezoneOffset(date: Date, timezoneOffset: number): Date {
        const calDate = new Date(date.getTime());
        calDate.setMinutes(calDate.getMinutes() + timezoneOffset);
        return calDate;
    }

    private setIdfromChannelIdAndDate(data: StandupStatus) {
        data.id = this.buildId(data.channelId, data.standupDate);
    }
}