import {StandupDataDao} from "./StandupDataDao";
import {StandupStatus} from "./StandupStatus";

export interface StandupStatusDao extends StandupDataDao<StandupStatus> {
    getChannelDataForDate(id: string, date: Date, userId: string) : Promise<StandupStatus | null>
    removeStandupStatusData(channelId: string, date: Date, userId: string): Promise<StandupStatus | undefined>
}