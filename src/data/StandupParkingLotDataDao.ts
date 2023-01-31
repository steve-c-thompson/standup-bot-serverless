import {StandupParkingLotData} from "./StandupParkingLotData";

export interface StandupParkingLotDataDao {
    getChannelParkingLotDataForDate(id: string, date: Date) : Promise<StandupParkingLotData | null>,
    putStandupParkingLotData(data: StandupParkingLotData) : Promise<StandupParkingLotData>,
    updateStandupParkingLotData(data: StandupParkingLotData) : Promise<StandupParkingLotData>,
}