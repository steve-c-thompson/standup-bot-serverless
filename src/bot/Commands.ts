/**
 * This class is used to pass data between the App and SlackBot.
 *
 * messageId is the ID of the message that was sent or scheduled
 * postAt is the time the message was sent or scheduled, which is expected to also
 * be the date of the standup. This is important because the Slack API does not return
 * the date a chat message was sent.
 */
export class ChangeMessageCommand {
    messageId: string
    postAt: number

    constructor(messageId: string, postAt: number) {
        this.messageId = messageId;
        this.postAt = postAt;
    }

    public formatForTransfer(): string {
        return this.messageId + "#" + this.postAt;
    }

    public static buildFromString(str: string): ChangeMessageCommand | null {
        let parts = str.split("#");
        if (parts.length != 2) {
            return null;
        }
        return new ChangeMessageCommand(parts[0], Number(parts[1]));
    }
}