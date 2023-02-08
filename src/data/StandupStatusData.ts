import {StandupData} from "./StandupData";
import {attribute, hashKey, rangeKey, table} from "@aws/dynamodb-data-mapper-annotations";
import {standupStatusTableName} from "../utils/context";

@table(standupStatusTableName)
export class StandupStatusData implements StandupData{
    @hashKey()
    channelId: string;

    @rangeKey({
        defaultProvider: () => {
            const d = new Date();
            d.setUTCHours(0, 0, 0, 0);
            return d;
        }
    }) standupDate?: Date; // epoch midnight for standup

    @rangeKey()
    userId: string;

    @attribute()
    yesterday: string;

    @attribute()
    today: string;

    @attribute()
    parkingLot?: string;

    @attribute()
    parkingLotAttendees?: string[] = [];

    @attribute()
    scheduleDateStr?: string;

    @attribute()
    scheduleTimeStr?: string;

    @attribute({defaultProvider: () => new Date()}) createdAt?: Date;

    @attribute({defaultProvider: () => new Date()}) updatedAt?: Date;

    @attribute({defaultProvider: () => {
            let date = new Date();
            date.setDate(date.getDate() + 1);
            return date;
        }
    }) timeToLive?: Date;
}