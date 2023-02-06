
export interface MessageCommand {
    channelId: string,
    userId: string,
    formatForTransfer() : string
}

export class ChangePostedMessageCommand implements MessageCommand {
    ts: string
    channelId: string;
    userId: string;

    constructor(ts: string, channelId: string, userId: string) {
        this.ts = ts;
        this.channelId = channelId;
        this.userId = userId;
    }

    formatForTransfer(): string {
        return this.ts + "#" + this.channelId + "#" + this.userId;;
    }

    public static buildFromString(str: string): ChangePostedMessageCommand | null {
        let parts = str.split("#");
        if (parts.length != 3) {
            return null;
        }
        return new ChangePostedMessageCommand(parts[0], parts[1], parts[2]);
    }
}

export class ChangeScheduledMessageCommand implements MessageCommand {
    channelId: string
    userId: string
    messageId: string
    postAt: number

    constructor(messageId: string, channelId: string, postAt: number, userId: string) {
        this.messageId = messageId;
        this.channelId = channelId;
        this.postAt = postAt;
        this.userId = userId;
    }

    public formatForTransfer(): string {
        return this.messageId + "#" + this.channelId + "#" + this.postAt + "#" + this.userId;
    }

    public static buildFromString(str: string): ChangeScheduledMessageCommand | null {
        let parts = str.split("#");
        if (parts.length != 4) {
            return null;
        }
        return new ChangeScheduledMessageCommand(parts[0], parts[1], Number(parts[2]), parts[3]);
    }
}