import {StandupStatus} from "./StandupStatus";

export interface StandupStatusDao {
    getChannelDataForDate(id: string, date: Date) : Promise<StandupStatus[]>
    getChannelData(channelId: string, date: Date, userId: string) : Promise<StandupStatus | null>
    removeStandupStatusData(channelId: string, date: Date, userId: string): Promise<StandupStatus | undefined>
    putData(channelId: string, standupDate: Date, userId: string,data: StandupStatus) : Promise<StandupStatus>,
    updateData(channelId: string, standupDate: Date, userId: string,data: StandupStatus) : Promise<StandupStatus>,
}