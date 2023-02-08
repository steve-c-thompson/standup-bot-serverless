import {DynamoDbStandupStatusDao} from "./DynamoDbStandupStatusDao";
import {context} from "../utils/context";
import {createStandupStatus, jan1, jan2} from "../test/scripts/create-dynamodb";
import {DataMapper} from "@aws/dynamodb-data-mapper";
import {StandupStatus} from "./StandupStatus";
import {newPartial} from "../utils/objectutils";

const jan1Zero = new Date(jan1.getTime());
jan1Zero.setUTCHours(0, 0, 0, 0);
const jan2Zero = new Date(jan2.getTime());
jan2Zero.setUTCHours(0, 0, 0, 0);

beforeEach(async () => {
    await createStandupStatus();
    const mapper = new DataMapper({client: context.dynamoDbClient, tableNamePrefix: context.tableNamePrefix});
    const status: StandupStatus = new StandupStatus({
        id: "ABC#Ronnie",
        standupDate: jan1Zero,
        today: "today",
        yesterday: "yesterday",
        parkingLot: "parking lot",
        parkingLotAttendees: ["Peter", "Paul", "Mary"],
        scheduleDateStr: "10/20/2020",
        scheduleTimeStr: "09:08"
    });
    const saved = await mapper.put(status);
    // console.log("Saved preloaded data " + JSON.stringify(saved));
});

afterAll(async () => {
   await createStandupStatus();
});

describe(DynamoDbStandupStatusDao.name, () => {
    const dao = new DynamoDbStandupStatusDao(context.dynamoDbClient);

    describe("should retrive", () => {
        it("an existing entity by nonzero date", async () => {
            const status = await dao.getChannelDataForDate("ABC", jan1, "Ronnie");
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#Ronnie");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.today).toEqual("today");
            expect(status?.yesterday).toEqual("yesterday");
            expect(status?.parkingLot).toEqual("parking lot");
            expect(status?.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(status?.scheduleDateStr).toEqual("10/20/2020");
            expect(status?.scheduleTimeStr).toEqual("09:08");
            expect(status?.timeToLive?.getTime()).toBeGreaterThan(jan1Zero.getTime());
        });
        it("null if not found", async () => {
            const status = await dao.getChannelDataForDate("ABC", jan2, "Ronnie");
            expect(status).toBeNull();
        });
    });

    describe("should put", () => {
        it("an entity with zeroed createDate and ttl = create + 1 day", async () => {
            const standupDate = new Date();
            const zeroDate = new Date();
            zeroDate.setUTCHours(0, 0, 0, 0);
            const expectedTtl = new Date(zeroDate.getTime());
            expectedTtl.setDate(zeroDate.getDate() + 1);

            const status: StandupStatus = new StandupStatus({
                id: "ABC#Ricky",
                standupDate: standupDate, // expect this to be zeroed
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Peter", "Paul", "Mary"],
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "09:08"
            });
            const saved = await dao.putData(status);
            expect(saved).toBeTruthy();
            expect(saved.standupDate).toEqual(zeroDate);
            expect(saved.timeToLive).toEqual(expectedTtl);
        });
    });
});