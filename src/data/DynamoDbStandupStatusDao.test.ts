import {DynamoDbStandupStatusDao} from "./DynamoDbStandupStatusDao";
import {appContext} from "../utils/appContext";
import {createStandupStatus, jan1, jan2} from "../test/scripts/create-dynamodb";
import {DataMapper} from "@aws/dynamodb-data-mapper";
import {StandupStatus, StatusMessage} from "./StandupStatus";

const jan1Zero = new Date(jan1.getTime());
jan1Zero.setUTCHours(0, 0, 0, 0);
const jan2Zero = new Date(jan2.getTime());
jan2Zero.setUTCHours(0, 0, 0, 0);

const tzOffset = -420; // 7 hours behind UTC
const jan1TwelvePmTz = new Date(jan2Zero.getTime() - 5 * 60 * 60 * 1000); // midnight UTC is 5pm previous day
const jan1ElevenPmTz = new Date(jan2Zero.getTime() + 6 * 60 * 60 * 1000);

beforeEach(async () => {
    await createStandupStatus();
    const mapper = new DataMapper({client: appContext.dynamoDbClient, tableNamePrefix: appContext.tableNamePrefix});
    const statusJimmy: StandupStatus = new StandupStatus({
        id: "ABC#" + jan1Zero.getTime(),
        channelId: "ABC",
        standupDate: jan1Zero,
        userTimezoneOffset: tzOffset,
        userId: "Jimmy",
        statusMessages: [
            {
                messageType: "posted",
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Peter", "Paul", "Mary"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "09:08",
                messageId: "12345",
                messageDate: jan1TwelvePmTz,
                userId: "Jimmy",
                channelId: "ABC",
            },
            {
                messageType: "posted",
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Peter", "Paul", "Mary"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "09:08",
                messageId: "abcdef",
                messageDate: jan1TwelvePmTz,
                userId: "Jimmy",
                channelId: "ABC",
            }],
        timeToLive: jan2Zero,
    });
    // Jimmy on Jan 2, channel DEF, jan2Zero
    const statusJimmy2: StandupStatus = new StandupStatus({
        id: "DEF#" + jan2Zero.getTime(),
        channelId: "DEF",
        standupDate: jan2Zero,
        userTimezoneOffset: tzOffset,
        userId: "Jimmy",
        statusMessages: [
            {
                messageType: "posted",
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Peter", "Paul", "Mary"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "09:08",
                messageId: "234567",
                messageDate: jan1TwelvePmTz,
                userId: "Jimmy",
                channelId: "DEF",
            }],
        timeToLive: jan2Zero,
    });
    const statusDave: StandupStatus = new StandupStatus({
        id: "ABC#" + jan2Zero.getTime(),
        channelId: "ABC",
        standupDate: jan2Zero,
        userTimezoneOffset: tzOffset,
        userId: "Dave",
        statusMessages: [
            {
                messageType: "scheduled",
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Mike", "Peter", "Davy"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "09:08",
                messageId: "99999",
                messageDate: jan1ElevenPmTz,
                userId: "Dave",
                channelId: "ABC",
            }
        ],
        timeToLive: jan2Zero
    });
    await mapper.put(statusJimmy);
    await mapper.put(statusJimmy2);
    await mapper.put(statusDave);
    // console.log(JSON.stringify(stat, null, 2));
});

afterAll(async () => {
    await createStandupStatus();
});

describe(DynamoDbStandupStatusDao.name, () => {
    const dao = new DynamoDbStandupStatusDao(appContext.dynamoDbClient);

    describe("should retrieve", () => {
        it("an existing entity for a user", async () => {
            const status = await dao.getChannelData("ABC", jan1TwelvePmTz, "Jimmy", tzOffset);
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.userTimezoneOffset).toEqual(tzOffset);
            expect(status?.statusMessages).toHaveLength(2);
            expect(status?.statusMessages).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    messageType: "posted",
                    today: "today",
                    yesterday: "yesterday",
                    parkingLot: "parking lot",
                    parkingLotAttendees: ["Peter", "Paul", "Mary"],
                    pullRequests: "pull requests",
                    scheduleDateStr: "10/20/2020",
                    scheduleTimeStr: "09:08",
                    messageId: "12345",
                    channelId: "ABC",
                    userId: "Jimmy",
                    messageDate: jan1TwelvePmTz
                }),
                expect.objectContaining({
                    messageType: "posted",
                    today: "today",
                    yesterday: "yesterday",
                    parkingLot: "parking lot",
                    parkingLotAttendees: ["Peter", "Paul", "Mary"],
                    pullRequests: "pull requests",
                    scheduleDateStr: "10/20/2020",
                    scheduleTimeStr: "09:08",
                    messageId: "abcdef",
                    messageDate: jan1TwelvePmTz
                })
            ]));
            expect(status?.timeToLive).toEqual(jan2Zero);
        });
        it("existing entity when utc date is tomorrow", async () => {
            // offset should put us back to Jan 1
            const status = await dao.getChannelData("ABC", jan1ElevenPmTz, "Jimmy", tzOffset);
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.userTimezoneOffset).toEqual(tzOffset);
            expect(status?.statusMessages).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    messageType: "posted",
                    today: "today",
                    yesterday: "yesterday",
                    parkingLot: "parking lot",
                    parkingLotAttendees: ["Peter", "Paul", "Mary"],
                    pullRequests: "pull requests",
                    scheduleDateStr: "10/20/2020",
                    scheduleTimeStr: "09:08",
                    messageId: "12345",
                    messageDate: jan1TwelvePmTz
                }),
                expect.objectContaining({
                    messageType: "posted",
                    today: "today",
                    yesterday: "yesterday",
                    parkingLot: "parking lot",
                    parkingLotAttendees: ["Peter", "Paul", "Mary"],
                    pullRequests: "pull requests",
                    scheduleDateStr: "10/20/2020",
                    scheduleTimeStr: "09:08",
                    messageId: "abcdef",
                    messageDate: jan1TwelvePmTz
                })
            ]));
            expect(status?.timeToLive).toEqual(jan2Zero);
        });
        it("null for a non-existent entity", async () => {
            const status = await dao.getChannelData("ABC", jan2, "Jimmy", 0);
            expect(status).toBeNull();
        });
    });
    describe("should retrieve", () => {
        it("existing entities by nonzero date", async () => {
            const statuses = await dao.getChannelDataForDate("ABC", jan1, tzOffset);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(1);
            const status = statuses[0];
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.userTimezoneOffset).toEqual(tzOffset);
            expect(status?.statusMessages[0].today).toEqual("today");
            expect(status?.statusMessages[0].yesterday).toEqual("yesterday");
            expect(status?.statusMessages[0].parkingLot).toEqual("parking lot");
            expect(status?.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(status?.statusMessages[0].pullRequests).toEqual("pull requests");
            expect(status?.statusMessages[0].scheduleDateStr).toEqual("10/20/2020");
            expect(status?.statusMessages[0].scheduleTimeStr).toEqual("09:08");
        });
        it("existing entities when utc date is tomorrow", async () => {
            const statuses = await dao.getChannelDataForDate("ABC", jan1ElevenPmTz, tzOffset);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(1);
            const status = statuses[0];
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan1Zero);
            expect(status?.userTimezoneOffset).toEqual(tzOffset);
            expect(status?.statusMessages[0].today).toEqual("today");
            expect(status?.statusMessages[0].yesterday).toEqual("yesterday");
            expect(status?.statusMessages[0].parkingLot).toEqual("parking lot");
            expect(status?.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(status?.statusMessages[0].pullRequests).toEqual("pull requests");
            expect(status?.statusMessages[0].scheduleDateStr).toEqual("10/20/2020");
            expect(status?.statusMessages[0].scheduleTimeStr).toEqual("09:08");
        });
        it("empty array if no entity for that Year Month Day", async () => {
            const standupDate = new Date("2021-10-20T18:00:00.000-07:00");
            const statuses = await dao.getChannelDataForDate("ABC", standupDate, tzOffset);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(0);
        });
    });
    describe("should retrieve by user id", () => {
        it("existing entity by user id", async () => {
            const statuses = await dao.getStandupStatusesByUserId("Dave");
            const status = statuses[0];
            expect(status).toBeTruthy();
            expect(status?.id).toEqual("ABC#" + jan2Zero.getTime());
            expect(status?.userId).toEqual("Dave");
            expect(status?.channelId).toEqual("ABC");
            expect(status?.standupDate).toEqual(jan2Zero);
            expect(status?.userTimezoneOffset).toEqual(tzOffset);
            expect(status?.statusMessages[0].today).toEqual("today");
            expect(status?.statusMessages[0].yesterday).toEqual("yesterday");
            expect(status?.statusMessages[0].parkingLot).toEqual("parking lot");
            expect(status?.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Mike", "Peter", "Davy"]));
            expect(status?.statusMessages[0].pullRequests).toEqual("pull requests");
            expect(status?.statusMessages[0].scheduleDateStr).toEqual("10/20/2020");
            expect(status?.statusMessages[0].scheduleTimeStr).toEqual("09:08");
            expect(status?.statusMessages[0].messageId).toEqual("99999");
            expect(status?.statusMessages[0].messageDate).toEqual(jan1ElevenPmTz);
            expect(status?.timeToLive).toEqual(jan2Zero);
        });
        it("existing entities by user id even for different channels", async () => {
            expect(await dao.getStandupStatusesByUserId("Jimmy")).toHaveLength(2);
        });
        it("existing entities by user id filtered by standupDate and timezone", async () => {
            expect(await dao.getStandupStatusesByUserId("Jimmy", jan2, tzOffset)).toHaveLength(1);
        });
    });
    describe("should add status message", () => {
        it("to existing entity for standupDate", async () => {
            const newStatusMessage = new StatusMessage({
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Mike", "Peter", "Davy"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "10:10",
                messageId: "FFFF",
                messageDate: jan1TwelvePmTz
            });
            const status = await dao.addStatusMessage("ABC", jan1TwelvePmTz, "Jimmy", newStatusMessage, tzOffset);
            expect(status.statusMessages).toHaveLength(3);
            expect(status.statusMessages).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    messageId: "12345"
                }),
                expect.objectContaining({
                    messageId: "abcdef",
                }),
                expect.objectContaining({
                    messageId: "FFFF",
                    userId: "Jimmy",
                    channelId: "ABC",
                })]));
        });
        it("in place of existing status message", async () => {
            const replacement = new StatusMessage({
                today: "replaced today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Mike", "Peter", "Davy"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "10:10",
                messageId: "12345",
                messageDate: jan1TwelvePmTz
            });
            const status = await dao.addStatusMessage("ABC", jan1TwelvePmTz, "Jimmy", replacement, tzOffset);
            expect(status.statusMessages).toHaveLength(2);
            expect(status.statusMessages).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    today: "replaced today",
                    messageId: "12345",
                }),
                expect.objectContaining({
                    messageId: "abcdef",
                })]));
        });
        it("to new entity for userID", async () => {
            const newStatusMessage = new StatusMessage({
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Mike", "Peter", "Davy"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "10:10",
                messageId: "FFFF",
                messageDate: jan1TwelvePmTz
            });
            const status = await dao.addStatusMessage("ABC", jan1TwelvePmTz, "Jenny", newStatusMessage, tzOffset);
            expect(status).toBeTruthy();
            expect(status.statusMessages).toHaveLength(1);
            expect(status).toEqual(expect.objectContaining({
                userId: "Jenny",
                channelId: "ABC",
                standupDate: jan1Zero,
                id: "ABC#" + jan1Zero.getTime(),
                userTimezoneOffset: tzOffset,
                statusMessages: expect.arrayContaining([
                    expect.objectContaining({
                        messageId: "FFFF",
                    })],
                )
            }));
        });
        it("to new entity for existing userID but new standupDate", async () => {
            const newStatusMessage = new StatusMessage({
                today: "today",
                yesterday: "yesterday",
                parkingLot: "parking lot",
                parkingLotAttendees: ["Mike", "Peter", "Davy"],
                pullRequests: "pull requests",
                scheduleDateStr: "10/20/2020",
                scheduleTimeStr: "10:10",
                messageId: "FFFF",
                messageDate: jan1TwelvePmTz
            });
            const jan3TwelvePmTz = new Date(jan1TwelvePmTz);
            jan3TwelvePmTz.setDate(jan3TwelvePmTz.getDate() + 2);
            const jan3Zero = new Date(jan1Zero);
            jan3Zero.setDate(jan3Zero.getDate() + 2);
            const status = await dao.addStatusMessage("ABC", jan3TwelvePmTz, "Jimmy", newStatusMessage, tzOffset);
            expect(status).toBeTruthy();
            expect(status.statusMessages).toHaveLength(1);
            expect(status).toEqual(expect.objectContaining({
                userId: "Jimmy",
                channelId: "ABC",
                standupDate: jan3Zero,
                id: "ABC#" + jan3Zero.getTime(),
                userTimezoneOffset: tzOffset,
                statusMessages: expect.arrayContaining([
                    expect.objectContaining({
                        messageId: "FFFF",
                    })],
                )
            }));
            const savedStatus = await dao.getChannelData("ABC", jan3TwelvePmTz, "Jimmy", tzOffset);
            expect(savedStatus).toBeTruthy();
            expect(savedStatus?.statusMessages).toHaveLength(1);
        });
    });

    describe("should retrieve status messages", () => {
        it("existing entity by user id and message id", async () => {
           const msg = await dao.getStatusMessage("Dave", "99999");
              expect(msg).toBeTruthy();
                expect(msg?.today).toEqual("today");
                expect(msg?.yesterday).toEqual("yesterday");
                expect(msg?.parkingLot).toEqual("parking lot");
                expect(msg?.parkingLotAttendees).toEqual(expect.arrayContaining(["Mike", "Peter", "Davy"]));
        });
        it("undefined if no entity for that user id and message id", async () => {
            expect(await dao.getStatusMessage("Dave", "99998")).toBeUndefined();
        });
    });
    describe("should put", () => {
        it("an entity with zeroed createDate and ttl = create + 1 day", async () => {
            const standupDate = new Date();
            const zeroDate = new Date(standupDate.getTime());
            zeroDate.setMinutes(standupDate.getMinutes() + tzOffset);
            zeroDate.setUTCHours(0, 0, 0, 0);
            const expectedTtl = new Date(zeroDate.getTime());
            expectedTtl.setDate(zeroDate.getDate() + 2);

            const status: StandupStatus = new StandupStatus({
                statusMessages: [{
                    messageType: "posted",
                    today: "today",
                    yesterday: "yesterday",
                    parkingLot: "parking lot",
                    parkingLotAttendees: ["Peter", "Paul", "Mary"],
                    pullRequests: "pull requests",
                    scheduleDateStr: "10/20/2020",
                    scheduleTimeStr: "09:08",
                    messageId: "12345",
                    messageDate: jan1TwelvePmTz,
                    userId: "Jimmy",
                    channelId: "ABC",
                }],
                timeToLive: expectedTtl,
            });
            const saved = await dao.putData("ABC", standupDate, "Jimmy", status, tzOffset);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("ABC#" + zeroDate.getTime());
            expect(saved.channelId).toEqual("ABC");
            expect(saved.standupDate).toEqual(zeroDate);
            expect(saved.userTimezoneOffset).toEqual(tzOffset);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].messageType).toEqual("posted");
            expect(saved.statusMessages[0].today).toEqual("today");
            expect(saved.statusMessages[0].yesterday).toEqual("yesterday");
            expect(saved.statusMessages[0].parkingLot).toEqual("parking lot");
            expect(saved.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(saved.statusMessages[0].pullRequests).toEqual("pull requests");
            expect(saved.statusMessages[0].scheduleDateStr).toEqual("10/20/2020");
            expect(saved.statusMessages[0].scheduleTimeStr).toEqual("09:08");
            expect(saved.statusMessages[0].messageId).toEqual("12345");
            expect(saved.statusMessages[0].messageDate).toEqual(jan1TwelvePmTz);
            expect(saved.statusMessages[0].userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].channelId).toEqual("ABC");
        });
        it("an entity with timezone where utc date is different from local date", async () => {
            const standupDate = new Date("2021-10-20T18:00:00.000-07:00"); // 6PM
            const zeroDateToday = new Date("2021-10-20T00:00:00.000-00:00"); // 12AM UTC same day
            const expectedTtl = new Date(zeroDateToday.getTime());
            expectedTtl.setDate(zeroDateToday.getDate() + 2);

            const status: StandupStatus = new StandupStatus({
                statusMessages: [{
                    messageType: "posted",
                    today: "today",
                    yesterday: "yesterday",
                    parkingLot: "parking lot",
                    parkingLotAttendees: ["Peter", "Paul", "Mary"],
                    pullRequests: "pull requests",
                    scheduleDateStr: "10/20/2020",
                    scheduleTimeStr: "18:00",
                    messageId: "12345",
                    messageDate: jan1TwelvePmTz,
                    userId: "Jimmy",
                    channelId: "ABC",   // incorrect channel id to be overwritten
                }],
                timeToLive: expectedTtl,
                userTimezoneOffset: tzOffset,
            });
            const saved = await dao.putData("DDD", standupDate, "Jimmy", status, tzOffset);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("DDD#" + zeroDateToday.getTime());
            expect(saved.channelId).toEqual("DDD");
            expect(saved.standupDate).toEqual(zeroDateToday);
            expect(saved.userTimezoneOffset).toEqual(tzOffset);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].messageType).toEqual("posted");
            expect(saved.statusMessages[0].today).toEqual("today");
            expect(saved.statusMessages[0].yesterday).toEqual("yesterday");
            expect(saved.statusMessages[0].parkingLot).toEqual("parking lot");
            expect(saved.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(saved.statusMessages[0].pullRequests).toEqual("pull requests");
            expect(saved.statusMessages[0].scheduleDateStr).toEqual("10/20/2020");
            expect(saved.statusMessages[0].scheduleTimeStr).toEqual("18:00");
            expect(saved.statusMessages[0].messageId).toEqual("12345");
            expect(saved.statusMessages[0].messageDate).toEqual(jan1TwelvePmTz);
            expect(saved.statusMessages[0].userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].channelId).toEqual("DDD");
        });
        it("an entity with timezone where utc date midnight (next day) is different from local date", async () => {
            const standupDate = new Date("2021-10-20T17:00:00.000-07:00"); // 5PM
            const zeroDateToday = new Date("2021-10-20T00:00:00.000-00:00"); // 12AM UTC same day
            const expectedTtl = new Date(zeroDateToday.getTime());
            expectedTtl.setDate(zeroDateToday.getDate() + 2);

            const status: StandupStatus = new StandupStatus({
                statusMessages: [{
                    messageType: "posted",
                    today: "today",
                    yesterday: "yesterday",
                    parkingLot: "parking lot",
                    parkingLotAttendees: ["Peter", "Paul", "Mary"],
                    pullRequests: "pull requests",
                    scheduleDateStr: "10/20/2020",
                    scheduleTimeStr: "17:00",
                    messageId: "12345",
                    messageDate: jan1TwelvePmTz,
                    userId: "Jimmy",
                    channelId: "DDD",
                }],
                timeToLive: expectedTtl,
                userTimezoneOffset: tzOffset,
            });
            const saved = await dao.putData("DDD", standupDate, "Jimmy", status, tzOffset);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("DDD#" + zeroDateToday.getTime());
            expect(saved.channelId).toEqual("DDD");
            expect(saved.standupDate).toEqual(zeroDateToday);
            expect(saved.userTimezoneOffset).toEqual(tzOffset);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].messageType).toEqual("posted");
            expect(saved.statusMessages[0].today).toEqual("today");
            expect(saved.statusMessages[0].yesterday).toEqual("yesterday");
            expect(saved.statusMessages[0].parkingLot).toEqual("parking lot");
            expect(saved.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary"]));
            expect(saved.statusMessages[0].pullRequests).toEqual("pull requests");
            expect(saved.statusMessages[0].scheduleDateStr).toEqual("10/20/2020");
            expect(saved.statusMessages[0].scheduleTimeStr).toEqual("17:00");
            expect(saved.statusMessages[0].messageId).toEqual("12345");
            expect(saved.statusMessages[0].messageDate).toEqual(jan1TwelvePmTz);
        });
    });

    describe("should update", () => {
        it("an existing entity, keeping channelId and userId in statusMessage aligned", async () => {
            const standupDate = new Date("2021-10-20T12:00:00.000-07:00"); // 12PM
            const zeroDateToday = new Date("2021-10-20T00:00:00.000-00:00"); // 12AM UTC same day
            const expectedTtl = new Date(zeroDateToday.getTime());
            expectedTtl.setDate(zeroDateToday.getDate() + 2);

            const status: StandupStatus = new StandupStatus({
                statusMessages: [
                    {
                        messageType: "scheduled",
                        today: "today2",
                        yesterday: "yesterday2",
                        parkingLot: "parking lot2",
                        parkingLotAttendees: ["Peter", "Paul", "Mary", "John"],
                        scheduleDateStr: "10/20/2021",
                        scheduleTimeStr: "12:00",
                        messageId: "123456",
                        messageDate: jan1TwelvePmTz,
                        userId: "XXX",
                        channelId: "YYY",
                    }
                ],
                timeToLive: expectedTtl,
                userTimezoneOffset: tzOffset,
            });
            const saved = await dao.updateData("ABC", standupDate, "Jimmy", status, tzOffset);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("ABC#" + zeroDateToday.getTime());
            expect(saved.channelId).toEqual("ABC");
            expect(saved.standupDate).toEqual(zeroDateToday);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].messageType).toEqual("scheduled");
            expect(saved.statusMessages[0].today).toEqual("today2");
            expect(saved.statusMessages[0].yesterday).toEqual("yesterday2");
            expect(saved.statusMessages[0].parkingLot).toEqual("parking lot2");
            expect(saved.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary", "John"]));
            expect(saved.statusMessages[0].pullRequests).toBeUndefined();
            expect(saved.statusMessages[0].scheduleDateStr).toEqual("10/20/2021");
            expect(saved.statusMessages[0].scheduleTimeStr).toEqual("12:00");
            expect(saved.statusMessages[0].messageId).toEqual("123456");
            expect(saved.statusMessages[0].userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].channelId).toEqual("ABC");
        });
        it("an existing entity with timezone where utc date midnight (next day) is different from local date", async () => {
            const standupDate = new Date("2021-10-20T17:00:00.000-07:00"); // 5PM
            const zeroDateToday = new Date("2021-10-20T00:00:00.000-00:00"); // 12AM UTC same day
            const expectedTtl = new Date(zeroDateToday.getTime());
            expectedTtl.setDate(zeroDateToday.getDate() + 2);

            const status: StandupStatus = new StandupStatus({
                statusMessages: [{
                    messageType: "scheduled",
                    today: "today2",
                    yesterday: "yesterday2",
                    parkingLot: "parking lot2",
                    parkingLotAttendees: ["Peter", "Paul", "Mary", "John"],
                    scheduleDateStr: "10/20/2021",
                    scheduleTimeStr: "17:00",
                    messageId: "123456",
                    messageDate: jan1TwelvePmTz,
                    userId: "Jimmy",
                    channelId: "ABC",
                }],
                timeToLive: expectedTtl,
                userTimezoneOffset: tzOffset,
            });
            const saved = await dao.updateData("ABC", standupDate, "Jimmy", status, tzOffset);
            expect(saved).toBeTruthy();
            expect(saved.id).toEqual("ABC#" + zeroDateToday.getTime());
            expect(saved.channelId).toEqual("ABC");
            expect(saved.standupDate).toEqual(zeroDateToday);
            expect(saved.timeToLive).toEqual(expectedTtl);
            expect(saved.userId).toEqual("Jimmy");
            expect(saved.statusMessages[0].messageType).toEqual("scheduled");
            expect(saved.statusMessages[0].today).toEqual("today2");
            expect(saved.statusMessages[0].yesterday).toEqual("yesterday2");
            expect(saved.statusMessages[0].parkingLot).toEqual("parking lot2");
            expect(saved.statusMessages[0].parkingLotAttendees).toEqual(expect.arrayContaining(["Peter", "Paul", "Mary", "John"]));
            expect(saved.statusMessages[0].pullRequests).toBeUndefined();
            expect(saved.statusMessages[0].scheduleDateStr).toEqual("10/20/2021");
            expect(saved.statusMessages[0].scheduleTimeStr).toEqual("17:00");
            expect(saved.statusMessages[0].messageId).toEqual("123456");
            expect(saved.statusMessages[0].messageDate).toEqual(jan1TwelvePmTz);
        });
    });

    describe("should delete", () => {
        it("an existing entity", async () => {
            const status = await dao.removeStandupStatus("ABC", jan1TwelvePmTz, "Jimmy", tzOffset);
            expect(status).toBeTruthy();
            expect(status!.id).toEqual("ABC#" + jan1Zero.getTime());

            const statuses = await dao.getChannelDataForDate("ABC", jan1TwelvePmTz, tzOffset);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(0);
        });
        it("an existing entity with timezone where utc date midnight (next day) is different from local date", async () => {
            const zeroDateToday = jan1Zero;
            const timezone = tzOffset;
            const status = await dao.removeStandupStatus("ABC", jan1ElevenPmTz, "Jimmy", timezone);
            expect(status).toBeTruthy();
            expect(status!.id).toEqual("ABC#" + zeroDateToday.getTime());

            const statuses = await dao.getChannelDataForDate("ABC", jan1ElevenPmTz, timezone);
            expect(statuses).toBeTruthy();
            expect(statuses.length).toEqual(0);
        });
        it("return undefined if no entity for that channel, date, and user", async () => {
            const status = await dao.removeStandupStatus("ABC", jan2, "Jimmy", tzOffset);
            expect(status).toBeUndefined();
        });
    });
    describe("should delete by messageId", () => {
        it("an existing entity by messageId when all messages are removed", async () => {
            const status = await dao.removeStandupStatusMessageByUserIdAndMessageId("Dave", "99999");
            expect(status).toBeTruthy();
            // whole status is returned, without messages
            expect(status!.id).toEqual("ABC#" + jan2Zero.getTime());
            expect(status!.userId).toEqual("Dave");
            expect(status!.statusMessages).toEqual([]);

            // Dave now gone because there are no messages
            const statuses = await dao.getChannelDataForDate("ABC", jan2, tzOffset);
            expect(statuses).toEqual(expect.arrayContaining([]));
        });
        it("return undefined if no entity for that messageId", async () => {
            const status = await dao.removeStandupStatusMessageByUserIdAndMessageId("Nobody", "99999");
            expect(status).toBeUndefined();
        });
        it("return undefined if no entity for valid userId but wrong messageId", async () => {
            const status = await dao.removeStandupStatusMessageByUserIdAndMessageId("Dave", "88888");
            expect(status).toBeUndefined();
        });
        it("should not delete status if message is not the last one", async () => {
            const status = await dao.removeStandupStatusMessageByUserIdAndMessageId("Jimmy", "12345");
            expect(status).toBeTruthy();
            // whole status is returned, without messages
            expect(status!.id).toEqual("ABC#" + jan1Zero.getTime());
            expect(status!.userId).toEqual("Jimmy");
            expect(status!.statusMessages).toHaveLength(1);
            expect(status!.statusMessages[0].messageId).toEqual("abcdef");

            const statuses = await dao.getChannelDataForDate("ABC", jan1, tzOffset);
            expect(statuses[0]!.statusMessages[0].messageId).toEqual("abcdef");
        });
    });
});