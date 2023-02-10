/**
 * Simple interface for storing data between Slack views
 */
import {StandupDialogMessageType} from "../bot/SlackBot";

export interface PrivateMetadata {
    channelId?: string;
    userId?: string;
    messageId?: string;
    messageDate?: number;
    messageType: StandupDialogMessageType
}