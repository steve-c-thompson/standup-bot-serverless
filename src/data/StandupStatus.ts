import {attribute, hashKey, rangeKey, table} from "@aws/dynamodb-data-mapper-annotations";
import {standupStatusTableName} from "../utils/appContext";
import {embed} from "@aws/dynamodb-data-mapper";

export type StandupStatusType = "posted" | "scheduled";

export class StatusMessage {
    public constructor(init?:Partial<StatusMessage>) {
        Object.assign(this, init);
    }

    @attribute()
    messageId: string;

    @attribute()
    channelId: string;

    @attribute()
    userId: string;

    @attribute()
    messageDate: Date;

    @attribute()
    messageType: StandupStatusType;

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
}

@table(standupStatusTableName)
export class StandupStatus {

    public constructor(init?:Partial<StandupStatus>) {
        Object.assign(this, init);
    }

    @hashKey()
    id: string; // A concatenation of channelId#standupDate.getTime(), expected to be epoch midnight for standup
                // If a standup occurs on Jan1, 2020 in any timezone, the ID will use Jan1, 2020 00:00:00 UTC

    @rangeKey({
        type: "String",
        indexKeyConfigurations: {
            "userId-index": "HASH",
        },
        attributeName: "userId"
    })
    userId: string;

    @attribute({
        defaultProvider: () => {
            const d = new Date();
            d.setUTCHours(0, 0, 0, 0);
            return d;
        }
    }) standupDate: Date; // epoch midnight for standup, used in ID

    @attribute()
    userTimezoneOffset: number; // The timezone offset of the user in minutes

    @attribute()
    channelId: string;

    @attribute({memberType: embed(StatusMessage)})
    statusMessages: Array<StatusMessage> = [];

    @attribute({defaultProvider: () => new Date()}) createdAt?: Date;

    @attribute({defaultProvider: () => new Date()}) updatedAt?: Date;

    @attribute({defaultProvider: () => {
            let date = new Date();
            date.setDate(date.getDate() + 1);
            return date;
        }
    }) timeToLive?: Date;
}