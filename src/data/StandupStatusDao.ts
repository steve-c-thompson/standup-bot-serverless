import {StandupStatus} from "./StandupStatus";

export interface StandupStatusDao {
    getChannelDataForDate(id: string, date: Date, timezoneOffsetString?: string) : Promise<StandupStatus[]>
    getChannelData(channelId: string, date: Date, userId: string, timezoneOffsetString?: string) : Promise<StandupStatus | null>
    removeStandupStatusData(channelId: string, date: Date, userId: string, timezoneOffsetString?: string): Promise<StandupStatus | undefined>
    putData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffsetString?: string) : Promise<StandupStatus>,
    updateData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffsetString?: string) : Promise<StandupStatus>,
}