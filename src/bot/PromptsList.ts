/**
 * interface and constant list of prompts for display in the interface. This allows storing the key
 * for later. (Not sold on this implementation.)
 */
export interface PromptItem {
    index: string;
    displayText: string;
    messageText: string;
}
export const promptsList: Map<string, PromptItem> = new Map();
promptsList.set('0', {index: '0', displayText: "Standup Order:", messageText: "*Standup Order*\n"});
promptsList.set('1', {index: '1', displayText: "Review Item:", messageText: "*Review Item*\n"});