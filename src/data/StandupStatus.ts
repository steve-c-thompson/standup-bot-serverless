import {
  DynamoDBDateProperty,
  DynamoDBListProperty,
} from "../utils/aws/decorators.js";

export type StandupStatusType = "posted" | "scheduled";

export class StatusMessage {
  messageId: string;
  channelId: string;
  userId: string;
  @DynamoDBDateProperty()
  messageDate: Date;
  messageType: StandupStatusType;
  yesterday: string;
  today: string;
  parkingLot?: string;
  parkingLotAttendees?: string[] = [];
  pullRequests?: string;
  scheduleDateStr?: string;
  scheduleTimeStr?: string;
  @DynamoDBDateProperty()
  createdAt?: Date = new Date();
  @DynamoDBDateProperty()
  updatedAt?: Date = new Date();

  public constructor(init?: Partial<StatusMessage>) {
    Object.assign(this, init);
  }
}

export class StandupStatus {
  id: string; // A concatenation of channelId#standupDate.getTime(), expected to be epoch midnight for standup
  // If a standup occurs on Jan1, 2020 in any timezone, the ID will use Jan1, 2020 00:00:00 UTC
  userId: string;
  @DynamoDBDateProperty()
  standupDate: Date = new Date();
  userTimezoneOffset: number;
  channelId: string;
  @DynamoDBListProperty(StatusMessage)
  statusMessages: Array<StatusMessage> = [];
  @DynamoDBDateProperty()
  createdAt?: Date = new Date();
  @DynamoDBDateProperty()
  updatedAt?: Date = new Date();
  @DynamoDBDateProperty()
  timeToLive?: Date;

  public constructor(init?: Partial<StandupStatus>) {
    Object.assign(this, init);
    if (this.timeToLive === undefined) {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      this.timeToLive = date;
    }
    if (!this.standupDate) {
      this.standupDate = new Date();
    }
    this.standupDate.setUTCHours(0, 0, 0, 0);
  }
}
