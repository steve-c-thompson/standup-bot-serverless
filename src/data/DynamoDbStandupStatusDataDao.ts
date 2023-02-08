import {StandupStatusData} from "./StandupStatusData";
import {DynamoDbStandupDataDao} from "./DynamoDbStandupDataDao";

export class DynamoDbStandupStatusDataDao extends DynamoDbStandupDataDao<StandupStatusData> {

    // We cannot move this function into the base class because there is no `new T()` in TypeScript
    async getChannelDataForDate(channelId: string, date: Date): Promise<StandupStatusData | null> {
        const toFetch = new StandupStatusData();
        return super.getObject(toFetch, channelId, date);
    }
}