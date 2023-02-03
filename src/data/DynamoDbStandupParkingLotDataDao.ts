import {StandupParkingLotDataDao} from "./StandupParkingLotDataDao";
import {ParkingLotDataItem, StandupParkingLotData} from "./StandupParkingLotData";
import {DynamoDB} from "aws-sdk";
import {context, logger} from "../utils/context";
import {DataMapper} from "@aws/dynamodb-data-mapper";

/**
 * Use AWS DataMapper to get StandupParkingLotData, which depends on annotations in the StandupParkingLotData class.
 */
export class DynamoDbStandupParkingLotDataDao implements StandupParkingLotDataDao {
    private readonly client: DynamoDB;
    private readonly mapper: DataMapper;
    constructor(client: DynamoDB) {
        this.client = client
        this.mapper = new DataMapper(
            {client: this.client, tableNamePrefix: context.tableNamePrefix}
        );
    }

    async getChannelParkingLotDataForDate(id: string, date: Date): Promise<StandupParkingLotData | null> {
        const toFetch = new StandupParkingLotData();
        toFetch.channelId = id;
        toFetch.standupDate = DynamoDbStandupParkingLotDataDao.createZeroUtcDate(date);
        logger.debug("Fetching standup data " + id + " with date " + toFetch.standupDate.getTime());
        return Promise.resolve(this.mapper.get(toFetch)).catch(() => {return null});
    }

    async putStandupParkingLotData(data: StandupParkingLotData): Promise<StandupParkingLotData> {
        this.validateAndSetStandupDate(data);
        this.validateAndSetTtl(data);
        logger.debug("Storing standup data " + data.channelId + " with date " + data.standupDate?.getTime());
        return this.mapper.put(data);
    }

    async updateStandupParkingLotData(data: StandupParkingLotData): Promise<StandupParkingLotData> {
        data.updatedAt = new Date();
        this.validateAndSetStandupDate(data);
        return this.mapper.update(data, {onMissing: "skip"});
    }

    /**
     * Update standup parking lot data. If there are no content or parking lot attendees, this will
     * return null.
     * @param channelId
     * @param date
     * @param userId
     * @param parkingLotItems
     * @param parkingLotAttendees
     */
    async upsertStandupParkingLotData(channelId: string,
                                      date: Date,
                                      userId: string,
                                      parkingLotItems: string | null | undefined,
                                      parkingLotAttendees: string[]): Promise<StandupParkingLotData | null> {
        if (parkingLotItems || parkingLotAttendees.length > 0) {
            // check if this object already exists
            let d = await this.getChannelParkingLotDataForDate(channelId, date);
            if (d) {
                // updating, add or replace item for user
                let foundIndex = d.parkingLotData!.findIndex(p => {
                    return p.userId == userId;
                });
                if (foundIndex >= 0) {
                    d.parkingLotData![foundIndex] = {
                        userId: userId,
                        attendees: parkingLotAttendees,
                        content: parkingLotItems ? parkingLotItems : ""
                    }
                } else {
                    // push the new item onto the list
                    d.parkingLotData!.push({
                        userId: userId,
                        attendees: parkingLotAttendees,
                        content: parkingLotItems ? parkingLotItems : ""
                    });
                }

                return this.updateStandupParkingLotData(d);
            } else {
                d = new StandupParkingLotData();
                d.standupDate = date;
                d.channelId = channelId;
                d.parkingLotData = [
                    {
                        content: parkingLotItems ? parkingLotItems : "",
                        userId: userId,
                        attendees: parkingLotAttendees
                    }
                ]
                return this.putStandupParkingLotData(d);
            }
        }
        return null;
    }

    async removeStandupParkingLotData(channelId: string, date: Date, userId: string): Promise<StandupParkingLotData | null> {
        let d = await this.getChannelParkingLotDataForDate(channelId, date);
        if(d) {
            // updating, add or replace item for user
            let foundIndex = d.parkingLotData!.findIndex(p => {
                return p.userId == userId;
            });
            if (foundIndex >= 0) {
                d.parkingLotData!.splice(foundIndex, 1);
               return this.updateStandupParkingLotData(d);
            }
        }
        else {
            logger.warn(`Could not find parking lot data for ${channelId} and ${date.toLocaleString()}`);
        }
        return null;
    }

    private validateAndSetStandupDate(data: StandupParkingLotData) {
        if(!data.standupDate) {
            data.standupDate = new Date();
        }
        data.standupDate = DynamoDbStandupParkingLotDataDao.createZeroUtcDate(data.standupDate);
    }

    private validateAndSetTtl(data: StandupParkingLotData) {
        if(!data.timeToLive) {
            data.timeToLive = new Date(data.standupDate!);
            data.timeToLive.setDate(data.standupDate!.getDate() + 1);
        }
    }

    private static createZeroUtcDate(date: Date): Date {
        const d = new Date(date.getTime());
        d.setUTCHours(0, 0, 0, 0);
        return d;
    }

    /**
     * Simple object factory
     * @param channelId
     * @param date
     * @param parkingLotData
     */
    static standupParkingLotDataObjectFactory(channelId: string, date: Date, parkingLotData: ParkingLotDataItem[]){
        let data = new StandupParkingLotData();
        data.channelId = channelId;
        data.parkingLotData = parkingLotData;
        data.standupDate = this.createZeroUtcDate(date);
        const ttl = new Date(data.standupDate);
        ttl.setDate(ttl.getDate() + 1);
        data.timeToLive = ttl;
        return data;
    }
}