import {DynamoDbStandupStatusDao} from "./DynamoDbStandupStatusDao";
import {context} from "../utils/context";
import {createStandupStatus, jan1, jan2} from "../test/scripts/create-dynamodb";
import {DataMapper} from "@aws/dynamodb-data-mapper";
import {StandupStatus} from "./StandupStatus";

const jan1Zero = new Date(jan1.getTime());
jan1Zero.setUTCHours(0, 0, 0, 0);
const jan2Zero = new Date(jan2.getTime());
jan2Zero.setUTCHours(0, 0, 0, 0);

beforeEach(async () => {
    await createStandupStatus();
    const mapper = new DataMapper({client: context.dynamoDbClient, tableNamePrefix: context.tableNamePrefix});
    const status: StandupStatus = new StandupStatus({
        id: "ABC#" + jan1Zero.getTime(),
        channelId: "ABC",
        standupDate: jan1Zero,
        userId: "Jimmy",
        messageType: "posted",
        today: "today",
        yesterday: "yesterday",
        parkingLot: "parking lot",
        parkingLotAttendees: ["Peter", "Paul", "Mary"],
        pullRequests: "pull requests",
        scheduleDateStr: "10/20/2020",
        scheduleTimeStr: "09:08",
        messageId: "12345",
        timeToLive: jan2Zero
    });
    await mapper.put(status);
});

afterAll(async () => {
   await createStandupStatus();
});

describe(DynamoDbStandupStatusDao.name, () => {
    const dao = new DynamoDbStandupStatusDao(context.dynamoDbClient);

    describe("should retrieve", () => {
        it("an existing entity for a user", async () => {
            const status = await dao.getChannelData("ABC", jan1, "Jimmy");
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.today).toEqual("today");
            expect(status?.yesterday).toEqual("yesterday");
            expect(status?.parkingLot).toEqual("parking lot");
            expect(status?.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(status?.pullRequests).toEqual("pull requests");
            expect(status?.scheduleDateStr).toEqual("10/20/2020");
            expect(status?.scheduleTimeStr).toEqual("09:08");
            expect(status?.messageId).toEqual("12345");
            expect(status?.timeToLive).toEqual(jan2Zero);
        });
        it("existing entity when timezone is specified and utc date is tomorrow", async () => {
            const status = await dao.getChannelData("ABC", jan2Zero, "Jimmy", "-05:00");
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.today).toEqual("today");
            expect(status?.yesterday).toEqual("yesterday");
            expect(status?.parkingLot).toEqual("parking lot");
            expect(status?.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(status?.pullRequests).toEqual("pull requests");
            expect(status?.scheduleDateStr).toEqual("10/20/2020");
            expect(status?.scheduleTimeStr).toEqual("09:08");
            expect(status?.messageId).toEqual("12345");
            expect(status?.timeToLive).toEqual(jan2Zero);
        });
        it("null for a non-existent entity", async () => {
            const status = await dao.getChannelData("ABC", jan2, "Jimmy");
            expect(status).toBeNull();
        });
    });
    describe("should retrieve", () => {
        it("existing entities by nonzero date", async () => {
            const statuses = await dao.getChannelDataForDate("ABC", jan1);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(1);
            const status = statuses[0];
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.today).toEqual("today");
            expect(status?.yesterday).toEqual("yesterday");
            expect(status?.parkingLot).toEqual("parking lot");
            expect(status?.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(status?.pullRequests).toEqual("pull requests");
            expect(status?.scheduleDateStr).toEqual("10/20/2020");
            expect(status?.scheduleTimeStr).toEqual("09:08");
        });
        it("existing entities when timezone is specified and utc date is tomorrow", async () => {
            const standupDate = new Date(jan2Zero.getTime());
            standupDate.setUTCHours(0, 0, 0, 0);
            const statuses = await dao.getChannelDataForDate("ABC", standupDate, "-05:00");
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(1);
            const status = statuses[0];
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.today).toEqual("today");
            expect(status?.yesterday).toEqual("yesterday");
            expect(status?.parkingLot).toEqual("parking lot");
            expect(status?.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(status?.pullRequests).toEqual("pull requests");
            expect(status?.scheduleDateStr).toEqual("10/20/2020");
            expect(status?.scheduleTimeStr).toEqual("09:08");
        });
        it("empty array if no entity for that Year Month Day", async () => {
            const statuses = await dao.getChannelDataForDate("ABC", jan2);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(0);
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
                messageType: "posted",
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Peter", "Paul", "Mary"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "09:08",
                messageId: "12345",
                timeToLive: expectedTtl
            });
            const saved = await dao.putData("ABC", standupDate, "Jimmy", status);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("ABC#" + zeroDate.getTime());
            expect(saved.channelId).toEqual("ABC");
            expect(saved.standupDate).toEqual(zeroDate);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.messageType).toEqual("posted");
            expect(saved.today).toEqual("today");
            expect(saved.yesterday).toEqual("yesterday");
            expect(saved.parkingLot).toEqual("parking lot");
            expect(saved.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(saved.pullRequests).toEqual("pull requests");
            expect(saved.scheduleDateStr).toEqual("10/20/2020");
            expect(saved.scheduleTimeStr).toEqual("09:08");
            expect(saved.messageId).toEqual("12345");
        });
        it("an entity with timezone where utc date is different from local date", async () => {
            const standupDate = new Date("2021-10-20T18:00:00.000-07:00"); // 6PM
            const zeroDateToday = new Date("2021-10-20T00:00:00.000-00:00"); // 12AM UTC same day
            const expectedTtl = new Date(zeroDateToday.getTime());
            expectedTtl.setDate(zeroDateToday.getDate() + 1);
            const tz = "America/Denver";

            const status: StandupStatus = new StandupStatus({
                messageType: "posted",
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Peter", "Paul", "Mary"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "18:00",
                messageId: "12345",
                timeToLive: expectedTtl
            });
            const saved = await dao.putData("DDD", standupDate, "Jimmy", status, tz);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("DDD#" + zeroDateToday.getTime());
            expect(saved.channelId).toEqual("DDD");
            expect(saved.standupDate).toEqual(zeroDateToday);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.messageType).toEqual("posted");
            expect(saved.today).toEqual("today");
            expect(saved.yesterday).toEqual("yesterday");
            expect(saved.parkingLot).toEqual("parking lot");
            expect(saved.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(saved.pullRequests).toEqual("pull requests");
            expect(saved.scheduleDateStr).toEqual("10/20/2020");
            expect(saved.scheduleTimeStr).toEqual("18:00");
            expect(saved.messageId).toEqual("12345");
        });
        it("an entity with timezone where utc date midnight (next day) is different from local date", async () => {
            const standupDate = new Date("2021-10-20T17:00:00.000-07:00"); // 5PM
            const zeroDateToday = new Date("2021-10-20T00:00:00.000-00:00"); // 12AM UTC same day
            const expectedTtl = new Date(zeroDateToday.getTime());
            expectedTtl.setDate(zeroDateToday.getDate() + 1);
            const tz = "-07:00";

            const status: StandupStatus = new StandupStatus({
                messageType: "posted",
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Peter", "Paul", "Mary"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "17:00",
                messageId: "12345",
                timeToLive: expectedTtl
            });
            const saved = await dao.putData("DDD", standupDate, "Jimmy", status, tz);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("DDD#" + zeroDateToday.getTime());
            expect(saved.channelId).toEqual("DDD");
            expect(saved.standupDate).toEqual(zeroDateToday);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.messageType).toEqual("posted");
            expect(saved.today).toEqual("today");
            expect(saved.yesterday).toEqual("yesterday");
            expect(saved.parkingLot).toEqual("parking lot");
            expect(saved.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(saved.pullRequests).toEqual("pull requests");
            expect(saved.scheduleDateStr).toEqual("10/20/2020");
            expect(saved.scheduleTimeStr).toEqual("17:00");
            expect(saved.messageId).toEqual("12345");
        });
    });

    describe("should update", () => {
        it("an existing entity", async () => {
            const status: StandupStatus = new StandupStatus({
                messageType: "scheduled",
                today: "today2",
                yesterday: "yesterday2",
                parkingLot: "parking lot2",
                parkingLotAttendees: ["Peter", "Paul", "Mary", "John"],
                scheduleDateStr: "10/20/2021",
                scheduleTimeStr: "09:09",
                messageId: "123456",
                timeToLive: jan2Zero
            });
            const saved = await dao.putData("ABC", jan1Zero, "Jimmy", status);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(saved.channelId).toEqual("ABC");
            expect(saved.standupDate).toEqual(jan1Zero);
            expect(saved.timeToLive).toEqual(jan2Zero);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.messageType).toEqual("scheduled");
            expect(saved.today).toEqual("today2");
            expect(saved.yesterday).toEqual("yesterday2");
            expect(saved.parkingLot).toEqual("parking lot2");
            expect(saved.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary", "John"]));
            expect(saved.pullRequests).toBeUndefined();
            expect(saved.scheduleDateStr).toEqual("10/20/2021");
            expect(saved.scheduleTimeStr).toEqual("09:09");
            expect(saved.messageId).toEqual("123456");
        });
        it("an existing entity with timezone where utc date midnight (next day) is different from local date", async () => {
            const standupDate = new Date("2021-10-20T17:00:00.000-07:00"); // 5PM
            const zeroDateToday = new Date("2021-10-20T00:00:00.000-00:00"); // 12AM UTC same day
            const expectedTtl = new Date(zeroDateToday.getTime());
            expectedTtl.setDate(zeroDateToday.getDate() + 1);
            const tz = "-07:00";

            const status: StandupStatus = new StandupStatus({
                messageType: "scheduled",
                today: "today2",
                yesterday: "yesterday2",
                parkingLot: "parking lot2",
                parkingLotAttendees: ["Peter", "Paul", "Mary", "John"],
                scheduleDateStr: "10/20/2021",
                scheduleTimeStr: "17:00",
                messageId: "123456",
                timeToLive: expectedTtl
            });
            const saved = await dao.updateData("ABC", standupDate, "Jimmy", status, tz);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("ABC#" + zeroDateToday.getTime());
            expect(saved.channelId).toEqual("ABC");
            expect(saved.standupDate).toEqual(zeroDateToday);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.messageType).toEqual("scheduled");
            expect(saved.today).toEqual("today2");
            expect(saved.yesterday).toEqual("yesterday2");
            expect(saved.parkingLot).toEqual("parking lot2");
            expect(saved.parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary", "John"]));
            expect(saved.pullRequests).toBeUndefined();
            expect(saved.scheduleDateStr).toEqual("10/20/2021");
            expect(saved.scheduleTimeStr).toEqual("17:00");
            expect(saved.messageId).toEqual("123456");
        });
    });

    describe("should delete", () => {
        it("an existing entity", async () => {
            const status = await dao.removeStandupStatusData("ABC", jan1, "Jimmy");
            expect(status).toBeTruthy();
            expect(status!.id).toEqual("ABC#" + jan1Zero.getTime());

            const statuses = await dao.getChannelDataForDate("ABC", jan1);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(0);
        });
        it("an existing entity with timezone where utc date midnight (next day) is different from local date", async () => {
            const standupDate = jan2Zero;
            const zeroDateToday = jan1Zero;
            const timezone = "-07:00";
            const status = await dao.removeStandupStatusData("ABC", standupDate, "Jimmy", timezone);
            expect(status).toBeTruthy();
            expect(status!.id).toEqual("ABC#" + zeroDateToday.getTime());

            const statuses = await dao.getChannelDataForDate("ABC", standupDate);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(0);
        });
        it("return undefined if no entity for that channel, date, and user", async () => {
            const status = await dao.removeStandupStatusData("ABC", jan2, "Jimmy");
            expect(status).toBeUndefined();
        });
    });
});