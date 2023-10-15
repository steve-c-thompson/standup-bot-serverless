import { StandupStatus } from "../../data/StandupStatus";
import { customUnmarshall } from "./marshall";

describe("customUnmarshall", () => {
  describe("when fully hydrated object is passed", () => {
    it("should return the same object", () => {
      const dynamoDBItem = {
        standupDate: 1577923200000,
        statusMessages: [
          {
            yesterday: "yesterday",
            parkingLotAttendees: ["Mike", "Peter", "Davy"],
            parkingLot: "parking lot",
            messageType: "scheduled",
            today: "today",
            scheduleTimeStr: "09:08",
            messageId: "99999",
            pullRequests: "pull requests",
            messageDate: 1577944800000,
            userId: "Dave",
            scheduleDateStr: "10/20/2020",
            channelId: "ABC",
          },
        ],
        createdAt: 1697029851826,
        updatedAt: 1697029851826,
        timeToLive: 1577923200000,
        userTimezoneOffset: -420,
        id: "ABC#1577923200000",
        userId: "Dave",
        channelId: "ABC",
      };

      const result = customUnmarshall(dynamoDBItem, StandupStatus);
      
      expect(result.id).toBe("ABC#1577923200000");
      expect(result.userId).toBe("Dave");
      expect(result.channelId).toBe("ABC");
      expect(result.userTimezoneOffset).toBe(-420);
      expect(result.standupDate.getTime()).toBe(1577923200000);
      expect(result.createdAt.getTime()).toBeGreaterThan(
        result.standupDate.getTime()
      );
      expect(result.updatedAt.getTime()).toBeGreaterThan(
        result.standupDate.getTime()
      );
      expect(result.timeToLive.getTime()).toBe(1577923200000);
      expect(result.statusMessages[0].messageDate.getTime()).toBe(
        1577944800000
      );
      expect(result.statusMessages[0].scheduleDateStr).toBe("10/20/2020");
      expect(result.statusMessages[0].scheduleTimeStr).toBe("09:08");
      expect(result.statusMessages[0].today).toBe("today");
      expect(result.statusMessages[0].yesterday).toBe("yesterday");
      expect(result.statusMessages[0].parkingLot).toBe("parking lot");
      expect(result.statusMessages[0].parkingLotAttendees).toEqual(
        expect.arrayContaining(["Mike", "Peter", "Davy"])
      );
    });
    it("should return the same object with empty array for empty statusMessages", () => {
      const item = {
        createdAt: 1697232777156,
        timeToLive: 1577923200000,
        userTimezoneOffset: -420,
        id: "ABC#1577923200000",
        standupDate: 1577923200000,
        userId: "Dave",
        channelId: "ABC",
        updatedAt: 1697232777156,
      };
      const result = customUnmarshall(item, StandupStatus);
      expect(result.id).toBe("ABC#1577923200000");
      expect(result.userId).toBe("Dave");
      expect(result.channelId).toBe("ABC");
      expect(result.userTimezoneOffset).toBe(-420);
      expect(result.standupDate.getTime()).toBe(1577923200000);
      expect(result.createdAt.getTime()).toBeGreaterThan(
        result.standupDate.getTime()
      );
      expect(result.updatedAt.getTime()).toBeGreaterThan(
        result.standupDate.getTime()
      );
      expect(result.timeToLive.getTime()).toBe(1577923200000);
      expect(result.statusMessages).toEqual([]);
    });
  });
});
