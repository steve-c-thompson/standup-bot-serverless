import {StandupStatus} from "./StandupStatus";
import {StandupStatusDao} from "./StandupStatusDao";
import {createZeroUtcDate} from "../utils/datefunctions";
import {DynamoDB} from "aws-sdk";
import {DataMapper, QueryIterator} from "@aws/dynamodb-data-mapper";
import {context} from "../utils/context";

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
     */
    async getChannelData(channelId: string, date: Date, userId: string): Promise<StandupStatus | null> {
        date = createZeroUtcDate(date);
        const id = this.buildId(channelId, date);
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
     * Add data to database, ensuring that standupDate is UTC midnight, and TTL is 1 day past that
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     */
    async putData(channelId: string, standupDate: Date, userId: string, data: StandupStatus): Promise<StandupStatus> {
        data.channelId = channelId;
        data.standupDate = standupDate;
        data.userId = userId;
        this.validateAndSetDates(data);
        this.setIdfromChannelIdAndDate(data);
        return this.mapper.put(data);
    }

    /**
     * Update an object. Without a channelId, standupDate, and userId, we can't update the ID, so we need to pass it in.
     * @param channelId
     * @param standupDate
     * @param userId
     * @param data
     */
    async updateData(channelId: string, standupDate: Date, userId: string,data: StandupStatus): Promise<StandupStatus> {
        data.channelId = channelId;
        data.standupDate = standupDate;
        data.userId = userId;
        data.updatedAt = new Date();
        // ensure we keep the dates aligned
        this.validateAndSetDates(data);
        this.setIdfromChannelIdAndDate(data);
        return this.mapper.update(data, {onMissing: "skip"});
    }

    /**
     * Get all data for this channel and date, return empty array if none found.
     * @param channelId
     * @param date
     */
    async getChannelDataForDate(channelId: string, date: Date): Promise<StandupStatus[]> {
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
     * Remove data for this channel, date, and user
     * @param channelId
     * @param date
     * @param userId
     */
    async removeStandupStatusData(channelId: string, date: Date, userId: string): Promise<StandupStatus | undefined> {
        const d = new StandupStatus();
        d.id = this.buildId(channelId, date);
        d.userId = userId;
        return this.mapper.delete(d);
    }

    private buildId(channelId: string, date: Date) {
        const d = createZeroUtcDate(date);
        return channelId + "#" + d.getTime();
    }

    private validateAndSetDates(data: StandupStatus) {
        if (!data.standupDate) {
            data.standupDate = new Date();
        }
        data.standupDate = createZeroUtcDate(data.standupDate);
        data.timeToLive = new Date(data.standupDate!);
        data.timeToLive.setDate(data.standupDate!.getDate() + 1);
    }

    private setIdfromChannelIdAndDate(data: StandupStatus) {
        data.id = this.buildId(data.channelId, data.standupDate);
    }
}