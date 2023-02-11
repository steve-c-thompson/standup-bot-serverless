import {StandupStatus} from "./StandupStatus";
import {StandupStatusDao} from "./StandupStatusDao";
import {createZeroUtcDate} from "../utils/datefunctions";
import {DynamoDB} from "aws-sdk";
import {DataMapper, QueryIterator} from "@aws/dynamodb-data-mapper";
import {context, logger} from "../utils/context";
import moment from "moment";

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
     * @param date
     * @param userId
     * @param timezoneOffsetString - optional timezone string with format +/-HH:MM
     */
    async getChannelData(channelId: string, date: Date, userId: string, timezoneOffsetString?: string): Promise<StandupStatus | null> {
        let calDate = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffsetString);
        const id = this.buildId(channelId, calDate);
        const toFetch = new StandupStatus({
            id: id,
            userId: userId,
            standupDate: date
        });
        try {
            return await Promise.resolve(this.mapper.get(toFetch));
        } catch {
            return null;
        }
    }

    /**
     * Get all data for this channel and date, return empty array if none found.
     * @param channelId
     * @param date
     * @param timezoneOffsetString - optional timezone string with format +/-HH:MM
     */
    async getChannelDataForDate(channelId: string, date: Date, timezoneOffsetString?: string): Promise<StandupStatus[]> {
        date = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffsetString);
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
     * @param timezoneOffsetString - optional timezone string with format +/-HH:MM
     */
    async putData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffsetString?: string): Promise<StandupStatus> {
        data.channelId = channelId;
        data.standupDate = standupDate;
        data.userId = userId;
        this.validateAndSetDates(data, timezoneOffsetString);
        this.setIdfromChannelIdAndDate(data);
        return this.mapper.put(data);
    }

    /**
     * Update an object. Without a channelId, standupDate, and userId, we can't update the ID, so we need to pass it in.
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     * @param timezoneOffsetString - optional timezone string with format +/-HH:MM
     */
    async updateData(channelId: string, standupDate: Date, userId: string,data: StandupStatus, timezoneOffsetString?: string): Promise<StandupStatus> {
        data.channelId = channelId;
        data.standupDate = standupDate;
        data.userId = userId;
        data.updatedAt = new Date();
        // ensure we keep the dates aligned
        this.validateAndSetDates(data, timezoneOffsetString);
        this.setIdfromChannelIdAndDate(data);
        return this.mapper.update(data, {onMissing: "skip"});
    }

    /**
     * Remove data for this channel, date, and user
     * @param channelId
     * @param date
     * @param userId
     * @param timezoneOffsetString - optional timezone string with format +/-HH:MM
     */
    async removeStandupStatusData(channelId: string, date: Date, userId: string, timezoneOffsetString?: string): Promise<StandupStatus | undefined> {
        const d = new StandupStatus();
        date = this.calibrateStandupDateFromTimezoneOffset(date, timezoneOffsetString);
        d.id = this.buildId(channelId, date);
        d.userId = userId;
        return this.mapper.delete(d);
    }

    private buildId(channelId: string, date: Date) {
        const d = createZeroUtcDate(date);
        return channelId + "#" + d.getTime();
    }

    private validateAndSetDates(data: StandupStatus, timezoneOffsetString?: string) {
        if (!data.standupDate) {
            data.standupDate = new Date();
        }
        logger.debug("standupDate before calibrate: " + data.standupDate + " timezoneOffsetString: " + timezoneOffsetString);
        data.standupDate = this.calibrateStandupDateFromTimezoneOffset(data.standupDate, timezoneOffsetString);
        logger.debug("standupDate after calibrate: " + data.standupDate);
        // Now zero out the time, so that we can use it as a partition key
        data.standupDate = createZeroUtcDate(data.standupDate);
        logger.debug("standupDate after zeroing: " + data.standupDate);
        data.timeToLive = new Date(data.standupDate!);
        data.timeToLive.setDate(data.standupDate!.getDate() + 1);
    }

    private calibrateStandupDateFromTimezoneOffset(date: Date, timezoneOffsetString?: string): Date {
        let dt = date;
        // Does this date have a timezone offset that we need to account for?
        if(timezoneOffsetString) {
            // If so, we need to make sure that the standup date is set to the correct date, based on the timezone.
            // For example, if the user says "standup for today" in the US (UTC-5), we need to make sure that the standup date
            // is set to the previous day.
            // We can't just use the timezone to set the standup date, because the user might be in a timezone where it's
            // the next day, but they want to do the standup for the previous day.
            // So, we need to make sure that the standup date is set to the correct date, based on the timezone.
            dt = new Date(date.getTime());
            const timezoneOffsetMinutes = moment().utcOffset(timezoneOffsetString).utcOffset();
            dt.setMinutes(date.getMinutes() + timezoneOffsetMinutes);
        }
        return dt;
    }

    private setIdfromChannelIdAndDate(data: StandupStatus) {
        data.id = this.buildId(data.channelId, data.standupDate);
    }
}