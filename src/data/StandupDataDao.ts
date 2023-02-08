
export interface StandupDataDao<T> {
    getChannelDataForDate(id: string, date: Date) : Promise<T | null>,
    putData(data: T) : Promise<T>,
    updateData(data: T) : Promise<T>,
    validateAndSetStandupDate(data: T): void
    validateAndSetTtl(data: T): void
}