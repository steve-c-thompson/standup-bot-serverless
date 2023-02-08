
export interface StandupDataDao<T> {
    validateAndSetStandupDate(data: T): void
    validateAndSetTtl(data: T): void
}