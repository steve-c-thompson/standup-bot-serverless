import {StandupStatus} from "./StandupStatus";
import {StandupStatusDao} from "./StandupStatusDao";
import {createZeroUtcDate} from "../utils/datefunctions";
import {DynamoDB} from "aws-sdk";
import {DataMapper, DynamoDbSchema, DynamoDbTable, QueryIterator} from "@aws/dynamodb-data-mapper";
import {context, logger} from "../utils/context";

export class StatusMessageIdProjection {
    messageId: string;
    id: string;
}

// Object.defineProperties(StatusMessageIdProjection.prototype, {
//     [DynamoDbSchema]: {
//         value: {
//             messageId: {type: 'String', keyType: 'HASH'},
//             id: {type: 'string'},
//             botId: {
//                 type: 'String',
//                 indexKeyConfigurations: {
//                     'tenantId-botId-Index': 'RANGE'
//                 }
//             },
//             tenantId: {
//                 type: 'String',
//                 indexKeyConfigurations: {
//                     'tenantId-botId-Index': 'HASH'
//                 }
//             },
//         }
//     }
// })

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

    async getChannelDataByMessageId(messageId: string): Promise<StandupStatus | null> {
        const query = {
            indexName: "messageId-index",
            keyCondition: {
                messageId: messageId
            },
            scanIndexForward: true,
            limit: 1,
            valueConstructor: StandupStatus,
        };
        const it: QueryIterator<StandupStatus> = await this.mapper.query(query);
        const arr = [];
        for await (const s of it) {
            arr.push(s);
        }

        if (arr.length > 0) {
            return arr[0];
            // // now get the whole objecct
            // const id = arr[0].id;
            // const it: QueryIterator<StandupStatus> = await this.mapper.query(StandupStatus, {
            //     id: id
            // });
            // const arr2 = [];
            // for await (const s of it) {
            //     arr2.push(s);
            // }
            // if(arr2.length > 0) {
            //     return arr2[0];
            // }
        }

        return null;
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
    async updateData(channelId: string, standupDate: Date, userId: string,data: StandupStatus, timezoneOffset: number): Promise<StandupStatus> {
        data.channelId = channelId;
        data.standupDate = standupDate;
        data.userId = userId;
        data.updatedAt = new Date();
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
    async removeStandupStatusData(channelId: string, date: Date, userId: string, timezoneOffset: number): Promise<StandupStatus | undefined> {
        const d = new StandupStatus();
        date = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffset);
        d.id = this.buildId(channelId, date);
        d.userId = userId;
        return this.mapper.delete(d);
    }

    async removeStandupStatusDataByMessageId(messageId: string): Promise<StandupStatus | undefined> {
        const obj = await this.getChannelDataByMessageId(messageId);
        if(obj) {
            return await this.mapper.delete(obj as unknown as StandupStatus);
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