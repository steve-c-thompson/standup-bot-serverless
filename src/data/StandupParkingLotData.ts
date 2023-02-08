import {attribute, hashKey, rangeKey, table} from "@aws/dynamodb-data-mapper-annotations";
import {standupParkingLotTableName} from "../utils/context";
import {embed} from "@aws/dynamodb-data-mapper";
import {StandupData} from "./StandupData";

export class ParkingLotDataItem {
    @attribute()
    userId: string;

    @attribute()
    content: string;

    @attribute()
    attendees?: string[] = []
}

@table(standupParkingLotTableName)
export class StandupParkingLotData implements StandupData {

    public constructor(init?:Partial<StandupParkingLotData>) {
        Object.assign(this, init);
    }

    @hashKey() id: string;

    @rangeKey({
            defaultProvider: () => {
                const d = new Date();
                d.setUTCHours(0, 0, 0, 0);
                return d;
            }
        }) standupDate: Date; // epoch midnight for standup

    @attribute({memberType: embed(ParkingLotDataItem)})
    parkingLotData?: Array<ParkingLotDataItem> = [];

    @attribute({defaultProvider: () => new Date()}) createdAt?: Date;

    @attribute({defaultProvider: () => new Date()}) updatedAt?: Date;

    @attribute({defaultProvider: () => {
            let date = new Date();
            date.setDate(date.getDate() + 1);
            return date;
        }
        }) timeToLive?: Date;
}