import {StandupStatus, StatusMessage} from "./StandupStatus";

export interface StandupStatusDao {
    getChannelDataForDate(id: string, date: Date, timezoneOffset: number) : Promise<StandupStatus[]>
    getChannelData(channelId: string, date: Date, userId: string, timezoneOffset: number) : Promise<StandupStatus | null>
    getStandupStatusesByUserId(userId: string, standupDateAfter?: Date, timezoneOffset?: number) : Promise<StandupStatus[]>
    getStatusMessage(userId: string, messageId: string) : Promise<StatusMessage | undefined>
    addStatusMessage(channelId: string, standupDate: Date, userId: string, data: StatusMessage, timezoneOffset: number): Promise<StandupStatus>
    removeStandupStatus(channelId: string, date: Date, userId: string, timezoneOffset: number): Promise<StandupStatus | undefined>
    removeStandupStatusMessageByUserIdAndMessageId(userId: string, messageId: string): Promise<StandupStatus | undefined>
    putData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffset?: number) : Promise<StandupStatus>,
    updateData(channelId: string, standupDate: Date, userId: string, data: StandupStatus, timezoneOffset?: number) : Promise<StandupStatus>,
}