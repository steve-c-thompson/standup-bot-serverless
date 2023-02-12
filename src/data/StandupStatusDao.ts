import {StandupStatus} from "./StandupStatus";

export interface StandupStatusDao {
    getChannelDataForDate(id: string, date: Date, timezoneOffset: number) : Promise<StandupStatus[]>
    getChannelData(channelId: string, date: Date, userId: string, timezoneOffset: number) : Promise<StandupStatus | null>
    getChannelDataByMessageId(messageId: string) : Promise<StandupStatus | null>
    removeStandupStatusData(channelId: string, date: Date, userId: string, timezoneOffset: number): Promise<StandupStatus | undefined>
    removeStandupStatusDataByMessageId(messageId: string): Promise<StandupStatus | undefined>
    putData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffset?: number) : Promise<StandupStatus>,
    updateData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffset?: number) : Promise<StandupStatus>,
}