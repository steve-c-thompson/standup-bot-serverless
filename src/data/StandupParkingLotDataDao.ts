import {StandupParkingLotData} from "./StandupParkingLotData";
import {StandupDataDao} from "./StandupDataDao";

export interface StandupParkingLotDataDao extends StandupDataDao<StandupParkingLotData> {
    upsertStandupParkingLotData(channelId: string,
                                date: Date,
                                userId: string,
                                parkingLotItems: string | null | undefined,
                                parkingLotAttendees: string[]) : Promise<StandupParkingLotData | null>,
    removeStandupParkingLotData(channelId: string, date: Date, userId: string): Promise<StandupParkingLotData | null>
}