import {PrivateMetadata} from "./PrivateMetadata";

export class StandupViewData {
    pm: PrivateMetadata
    yesterday: string
    today: string
    parkingLot?: string | null | undefined
    attendees: string[] = []
    pullRequests?: string | null | undefined
    scheduleDateTime?: number | null | undefined
    timezone?: string
    dateStr?: string | null | undefined
    timeStr?: string | null | undefined

    public constructor(init?:Partial<StandupViewData>) {
        Object.assign(this, init);
    }
}