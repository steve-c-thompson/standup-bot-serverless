import {StandupStatus} from "./StandupStatus";
import {DynamoDbStandupDao} from "./DynamoDbStandupDao";
import {StandupStatusDao} from "./StandupStatusDao";
import {createZeroUtcDate} from "../utils/datefunctions";
import {DynamoDB} from "aws-sdk";
import {DataMapper} from "@aws/dynamodb-data-mapper";
import {context} from "../utils/context";

export class DynamoDbStandupStatusDao extends DynamoDbStandupDao<StandupStatus> implements StandupStatusDao {
    constructor(client: DynamoDB) {
        super(client, new DataMapper(
            {client: client, tableNamePrefix: context.tableNamePrefix}
        ));
    }
    async getChannelDataForDate(channelId: string, date: Date, userId: string): Promise<StandupStatus | null> {
        const toFetch = new StandupStatus();
        const id = this.buildId(channelId, userId);
        return super.getObject(toFetch, id, date);
    }

    async removeStandupStatusData(channelId: string, date: Date, userId: string): Promise<StandupStatus | undefined> {
        const d = new StandupStatus();
        d.id = this.buildId(channelId, userId);
        d.standupDate = createZeroUtcDate(date);
        return super.mapper.delete(d);
    }

    private buildId(channelId: string, userId: string) {
        return channelId + "#" + userId;
    }
}