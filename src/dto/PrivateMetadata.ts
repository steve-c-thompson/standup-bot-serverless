/**
 * Simple interface for storing data between Slack views
 */
import {StandupStatusType} from "../data/StandupStatus";

export interface PrivateMetadata {
    channelId?: string;
    userId?: string;
    messageId?: string;
    messageDate?: number;
    messageType: StandupStatusType
}