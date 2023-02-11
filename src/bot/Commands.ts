/**
 * This class is used to pass data between the App and SlackBot.
 *
 * messageId is the ID of the message that was sent or scheduled
 * postAt is the time the message was sent or scheduled, which is expected to also
 * be the date of the standup
 */
export class ChangeMessageCommand {
    channelId: string
    userId: string
    messageId: string
    postAt: number
    timezoneIANA: string

    constructor(messageId: string, channelId: string, postAt: number, userId: string, timezoneIANA: string) {
        this.messageId = messageId;
        this.channelId = channelId;
        this.postAt = postAt;
        this.userId = userId;
        this.timezoneIANA = timezoneIANA;
    }

    public formatForTransfer(): string {
        return this.messageId + "#" + this.channelId + "#" + this.postAt + "#" + this.userId + "#" + this.timezoneIANA;
    }

    public static buildFromString(str: string): ChangeMessageCommand | null {
        let parts = str.split("#");
        if (parts.length != 5) {
            return null;
        }
        return new ChangeMessageCommand(parts[0], parts[1], Number(parts[2]), parts[3], parts[4]);
    }
}