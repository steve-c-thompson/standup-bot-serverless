import {attribute, hashKey, rangeKey, table} from "@aws/dynamodb-data-mapper-annotations";
import {standupStatusTableName} from "../utils/context";

export type StandupStatusType = "posted" | "scheduled";

@table(standupStatusTableName)
export class StandupStatus {

    public constructor(init?:Partial<StandupStatus>) {
        Object.assign(this, init);
    }

    @hashKey()
    id: string; // A concatenation of channelId#standupDate.getTime(), expected to be epoch midnight for standup

    @rangeKey()
    userId: string;

    @attribute({
        defaultProvider: () => {
            const d = new Date();
            d.setUTCHours(0, 0, 0, 0);
            return d;
        }
    }) standupDate: Date; // epoch midnight for standup, used in ID

    @attribute()
    channelId: string;

    @attribute()
    yesterday: string;

    @attribute()
    today: string;

    @attribute()
    parkingLot?: string;

    @attribute()
    parkingLotAttendees?: string[] = [];

    @attribute()
    pullRequests?: string;

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

    // The message ID if this message was sent or scheduled
    @attribute()
    messageId?: string;

    @attribute()
    messageType: StandupStatusType;
}