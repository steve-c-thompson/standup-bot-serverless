import {StandupParkingLotData} from "./StandupParkingLotData";
import {StandupDataDao} from "./StandupDataDao";

export interface StandupParkingLotDataDao extends StandupDataDao<StandupParkingLotData> {
    getChannelParkingLotDataForDate(id: string, date: Date) : Promise<StandupParkingLotData | null>,
    putStandupParkingLotData(data: StandupParkingLotData) : Promise<StandupParkingLotData>,
    updateStandupParkingLotData(data: StandupParkingLotData) : Promise<StandupParkingLotData>,

    upsertStandupParkingLotData(channelId: string,
                                date: Date,
                                userId: string,
                                parkingLotItems: string | null | undefined,
                                parkingLotAttendees: string[]) : Promise<StandupParkingLotData | null>,
    removeStandupParkingLotData(channelId: string, date: Date, userId: string): Promise<StandupParkingLotData | null>
}