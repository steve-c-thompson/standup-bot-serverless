export type ActionNameKey = "YESTERDAY" | "TODAY" | "PARKING_LOT" | "PARTICIPANTS"
    | "PULL_REQUESTS" | "SCHEDULE_DATE" | "SCHEDULE_TIME"
    | "DELETE_SCHEDULED_MESSAGE" | "EDIT_SCHEDULED_MESSAGE"
    | "EDIT_MESSAGE";
export const ACTION_NAMES: Map<ActionNameKey, string> = new Map([
    ["YESTERDAY", "yesterday-action"],
    ["TODAY", "today-action"],
    ["PARKING_LOT", "parking-lot-action"],
    ["PARTICIPANTS", "parking-lot-participants-action"],
    ["PULL_REQUESTS", "pull-requests-action"],
    ["SCHEDULE_DATE", "schedule-date-action"],
    ["SCHEDULE_TIME", "schedule-time-action"],
    ["DELETE_SCHEDULED_MESSAGE", "delete-scheduled-msg-action"],
    ["EDIT_SCHEDULED_MESSAGE", "edit-scheduled-msg-action"],
    ["EDIT_MESSAGE", "edit-msg-action"],
]);