import {DynamoDbStandupParkingLotDataDao} from "./DynamoDbStandupParkingLotDataDao";
import {context, standupParkingLotTableName} from "../utils/context";
import {dbCleanup, jan1, jan2, testParkingLotData} from "../test/scripts/create-dynamodb";
import {StandupParkingLotData} from "./StandupParkingLotData";

// Make sure the database is in an acceptable state
beforeEach(async () => {
    await dbCleanup();
});

// Now leave it how we found it
afterAll( async () => {
    await dbCleanup();
})
describe(DynamoDbStandupParkingLotDataDao.name, () => {
    const dao = new DynamoDbStandupParkingLotDataDao(context.dynamoDbClient);

    const jan1Zero = new Date(jan1.getTime());
    jan1Zero.setUTCHours(0, 0, 0, 0);
    const jan2Zero = new Date(jan2.getTime());
    jan2Zero.setUTCHours(0, 0, 0, 0);

    describe('should retrieve', () => {
        it("an existing entity", async () => {
            let r = await dao.getChannelParkingLotDataForDate("ABC", jan1);
            expect(r).toBeTruthy();
            expect(r?.channelId).toEqual("ABC");
            expect(r?.createdAt).toBeTruthy();
            expect(r?.updatedAt).toBeTruthy();
            expect(r?.channelId).toBeTruthy();
            expect(r?.timeToLive).toBeTruthy();
            expect(r?.parkingLotData).toHaveLength(2);
        });
        it("an existing entity with ttl day plus one", async () => {
            let r = await dao.getChannelParkingLotDataForDate("ABC", jan1);
            expect(r).toBeTruthy();
            expect(r?.channelId).toEqual("ABC");
            expect(r?.timeToLive).toEqual(jan2Zero);
            expect(r?.parkingLotData).toHaveLength(2);
        });
        it("null if no data for that Year Month Day", async () => {
            let r = await dao.getChannelParkingLotDataForDate("ABC", jan2);
            expect(r).toBeNull();
        })
    });

    describe("should update", () => {
            it('an existing data without overwriting missing data', async () => {
                let d = new StandupParkingLotData();
                d.channelId = "ABC";
                d.standupDate = jan1;
                d.parkingLotData = undefined; // set the data to missing value
                d = await dao.updateStandupParkingLotData(d);
                expect(d?.parkingLotData).toHaveLength(2);
                expect(d?.createdAt).toBeTruthy();
                expect(d?.updatedAt).toBeTruthy();
                expect(d?.timeToLive).toBeTruthy();
                expect(d?.timeToLive?.getTime()).toBeGreaterThan(d.standupDate?.getTime()!);
            });
            it('and zero out standupDate', async () => {
                let d = DynamoDbStandupParkingLotDataDao.standupParkingLotDataObjectFactory("ABC", jan1, []);
                let standupDate = new Date('December 17, 2015 03:24:00');
                d.standupDate = standupDate;
                d = await dao.updateStandupParkingLotData(d);
                expect(d?.standupDate?.getUTCDate()).toEqual(standupDate.getUTCDate());
                expect(d?.standupDate?.getUTCDay()).toEqual(standupDate.getUTCDay());
                expect(d?.standupDate?.getUTCHours()).toEqual(0);
                expect(d?.standupDate?.getUTCMinutes()).toEqual(0);
            });

            it('fields including updatedAt but not createdAt or timeToLive', async () => {
                let d = DynamoDbStandupParkingLotDataDao.standupParkingLotDataObjectFactory("ABC", jan2, [
                    {
                        userId: "new",
                        content: "new content",
                    }
                ]);
                let createdAt = new Date('December 17, 2015 03:24:00');
                let ttl = new Date(createdAt.getTime());
                ttl.setDate(createdAt.getDate() + 1);
                d.createdAt = createdAt;
                d.updatedAt = createdAt;
                d.timeToLive = ttl;
                d = await dao.updateStandupParkingLotData(d);
                expect(d?.parkingLotData).toEqual([{
                    userId: "new",
                    content: "new content",
                    attendees: []
                }])
                expect(d?.createdAt).toEqual(createdAt);
                expect(d?.updatedAt?.getTime()).toBeGreaterThan(createdAt.getTime());
                expect(d?.timeToLive).toEqual(ttl);
            });
        }
    );

    it('should insert without error and zero standupDate', async () => {
        let d = new StandupParkingLotData();
        d.channelId = "XXX";
        d.standupDate = jan1;
        d.parkingLotData = [{
            userId: "new",
            content: "new content",
            attendees: ["Ricky"]
        }];

        try {
            d = await dao.putStandupParkingLotData(d);
        } catch (e) {
            console.log(e);
        }
        expect(d?.channelId).toEqual("XXX");
        expect(d?.parkingLotData).toEqual([{
            userId: "new",
            content: "new content",
            attendees: ["Ricky"]
        }]);
        expect(d?.createdAt).toBeTruthy();
        const jan1Zero = new Date(jan1.getTime());
        jan1Zero.setUTCHours(0, 0, 0, 0);
        expect(d?.standupDate?.getTime()).toEqual(jan1Zero.getTime());
        expect(d?.timeToLive?.getTime()).toBeGreaterThan(d?.standupDate?.getTime()!);
    });

    describe("upsert",
        () => {
            it('should update existing', async () => {
                let d: StandupParkingLotData | null = null;

                try {
                    d = await dao.upsertStandupParkingLotData("ABC", jan1, "Ricky",
                        "items", [
                            "Mike",
                            "Mark"
                        ]);
                } catch (e) {
                    console.log(e);
                }
                expect(d?.channelId).toEqual("ABC");
                // also has existing
                expect(d?.parkingLotData).toEqual(expect.arrayContaining([{
                    userId: "Ricky",
                    content: "items",
                    attendees: ["Mike", "Mark"]
                },
                    testParkingLotData.parkingLotData![1]
                ]));
                expect(d?.createdAt).toBeTruthy();
                expect(d?.standupDate?.getTime()).toEqual(jan1Zero.getTime());
                expect(d?.timeToLive?.getTime()).toEqual(jan2Zero.getTime());
            }),
                it("should insert new", async () => {
                    let d: StandupParkingLotData | null = null;

                    try {
                        d = await dao.upsertStandupParkingLotData("ABC", jan1, "Bobby",
                            "things", [
                                "Dave",
                                "Donna"
                            ]);
                    } catch (e) {
                        console.log(e);
                    }
                    expect(d?.channelId).toEqual("ABC");
                    expect(d?.parkingLotData).toEqual(expect.arrayContaining([{
                        userId: "Bobby",
                        content: "things",
                        attendees: ["Dave", "Donna"]
                    },
                        testParkingLotData.parkingLotData![0],
                        testParkingLotData.parkingLotData![1]
                    ]));
                    expect(d?.createdAt).toBeTruthy();
                    expect(d?.standupDate?.getTime()).toEqual(jan1Zero.getTime());
                    expect(d?.timeToLive?.getTime()).toEqual(jan2Zero.getTime());
                }),
                it("should return null when there are no parking lot items and no attendees", async () => {
                    let d: StandupParkingLotData | null = null;

                    try {
                        d = await dao.upsertStandupParkingLotData("ABC", jan1, "XXX",
                            null, []);
                    } catch (e) {
                        console.log(e);
                    }
                    expect(d).toBeNull();
                })
        });

    describe("remove",  () => {
        it('should remove existing and return object', async () => {
            let result = await dao.removeStandupParkingLotData("ABC", jan1, "Ricky");
            expect(result).toBeTruthy();
            expect(result?.parkingLotData).toEqual(expect.arrayContaining([
                testParkingLotData.parkingLotData![1]
            ]));
            }
        ),
        it('should return null when channel ID and date not found', async () => {
            let result = await dao.removeStandupParkingLotData("DDD", jan1, "Bob");
            expect(result).toBeNull()
            }
        ),
        it('should return null when channel ID and date found but no user', async () => {
                let result = await dao.removeStandupParkingLotData("ABC", jan1, "Luda");
                expect(result).toBeNull()
            }
        )
    });

});


