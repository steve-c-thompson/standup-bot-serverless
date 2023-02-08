/**
 * Generic interface for StandupData DAOs
 */
export interface StandupDataDao<T> {
    putData(data: T) : Promise<T>,
    updateData(data: T) : Promise<T>,
    validateAndSetStandupDate(data: T): void
    validateAndSetTtl(data: T): void
}