/**
 * Simple interface for storing data between Slack views
 */
import {StandupMessageType} from "../bot/SlackBot";

export interface PrivateMetadata {
    channelId?: string;
    userId?: string;
    messageId?: string;
    messageType?: StandupMessageType
}