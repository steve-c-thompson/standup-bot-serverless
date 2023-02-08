import {StandupDataDaoImpl} from "./StandupDataDaoImpl";
import {DynamoDB} from "aws-sdk";
import {DataMapper} from "@aws/dynamodb-data-mapper";
import {createZeroUtcDate} from "../utils/datefunctions";
import {logger} from "../utils/context";
import {StandupData} from "./StandupData";

/**
 * Abstract base class for StandupDataDao types, using mapper
 *
 * https://awslabs.github.io/dynamodb-data-mapper-js/packages/dynamodb-data-mapper/
 */
export abstract class DynamoDbStandupDao<T extends StandupData> extends StandupDataDaoImpl<T> {
    protected readonly client: DynamoDB;
    protected readonly mapper: DataMapper;
    protected constructor(client: DynamoDB, mapper: DataMapper) {
        super();
        this.client = client;
        this.mapper = mapper;
    }

    /**
     * Add data to database, ensuring that standupDate is UTC midnight, and TTL is 1 day past that
     * @param data
     */
    async putData(data: T): Promise<T> {
        this.validateAndSetStandupDate(data);
        logger.debug("Storing standup data " + data.id + " with date " + data.standupDate?.getTime());
        return this.mapper.put(data);
    }

    async updateData(data: T): Promise<T> {
        data.updatedAt = new Date();
        // ensure we keep the dates aligned
        this.validateAndSetStandupDate(data);
        return this.mapper.update(data, {onMissing: "skip"});
    }

    /**
     * Get the object for a date. The date is zeroed to UTC for retrieval.
     * @param toFetch
     * @param id
     * @param date
     * @protected
     */
    protected async getObject(toFetch: T, id: string, date: Date): Promise<T | null> {
        toFetch.id = id;
        toFetch.standupDate = createZeroUtcDate(date);
        logger.debug("Fetching standup data " + id + " with date " + toFetch.standupDate.getTime());
        try {
            return await Promise.resolve(this.mapper.get(toFetch));
        } catch {
            return null;
        }
    }
}