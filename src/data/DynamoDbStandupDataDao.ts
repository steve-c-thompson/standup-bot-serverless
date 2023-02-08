import {StandupDataDaoImpl} from "./StandupDataDaoImpl";
import {DynamoDB} from "aws-sdk";
import {DataMapper} from "@aws/dynamodb-data-mapper";
import {createZeroUtcDate} from "../utils/datefunctions";
import {logger} from "../utils/context";
import {StandupData} from "./StandupData";

/**
 * Abstract base class for StandupDataDao types
 */
export abstract class DynamoDbStandupDataDao<T extends StandupData> extends StandupDataDaoImpl<T> {
    protected readonly client: DynamoDB;
    protected readonly mapper: DataMapper;
    protected constructor(client: DynamoDB, mapper: DataMapper) {
        super();
        this.client = client;
        this.mapper = mapper;
    }

    async putData(data: T): Promise<T> {
        this.validateAndSetStandupDate(data);
        this.validateAndSetTtl(data);
        logger.debug("Storing standup data " + data.channelId + " with date " + data.standupDate?.getTime());
        return this.mapper.put(data);
    }

    async updateData(data: T): Promise<T> {
        data.updatedAt = new Date();
        this.validateAndSetStandupDate(data);
        return this.mapper.update(data, {onMissing: "skip"});
    }

    protected async getObject(toFetch: T, channelId: string, date: Date): Promise<T | null> {
        toFetch.channelId = channelId;
        toFetch.standupDate = createZeroUtcDate(date);
        logger.debug("Fetching standup data " + channelId + " with date " + toFetch.standupDate.getTime());
        try {
            return await Promise.resolve(this.mapper.get(toFetch));
        } catch {
            return null;
        }
    }
}