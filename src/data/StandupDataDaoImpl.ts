import {StandupDataDao} from "./StandupDataDao";
import {createZeroUtcDate} from "../utils/datefunctions";
import {StandupData} from "./StandupData";

/**
 * Abstract base class for objects that have a standupDate and timeToLive
 */
export abstract class StandupDataDaoImpl<T extends StandupData> implements StandupDataDao<T>{

    abstract putData(data: T) : Promise<T>
    abstract updateData(data: T) : Promise<T>

    validateAndSetStandupDate(data: T) {
        if(!data.standupDate) {
            data.standupDate = new Date();
        }
        data.standupDate = createZeroUtcDate(data.standupDate);
        this.validateAndSetTtl(data);
    }

    /**
     * Set TTL to always be standupDate + 1 day
     * @param data
     */
    validateAndSetTtl(data: T) {
        data.timeToLive = new Date(data.standupDate!);
        data.timeToLive.setDate(data.standupDate!.getDate() + 1);
    }
}