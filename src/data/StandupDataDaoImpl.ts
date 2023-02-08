import {StandupDataDao} from "./StandupDataDao";
import {createZeroUtcDate} from "../utils/datefunctions";
import {StandupData} from "./StandupData";

/**
 * Abstract base class for objects that have a standupDate and timeToLive
 */
export abstract class StandupDataDaoImpl<T extends StandupData> implements StandupDataDao<T>{

    abstract getChannelDataForDate(id: string, date: Date) : Promise<T | null>
    abstract putData(data: T) : Promise<T>
    abstract updateData(data: T) : Promise<T>

    validateAndSetStandupDate(data: T) {
        if(!data.standupDate) {
            data.standupDate = new Date();
        }
        data.standupDate = createZeroUtcDate(data.standupDate);
    }

    validateAndSetTtl(data: T) {
        if(!data.timeToLive) {
            data.timeToLive = new Date(data.standupDate!);
            data.timeToLive.setDate(data.standupDate!.getDate() + 1);
        }
    }
}