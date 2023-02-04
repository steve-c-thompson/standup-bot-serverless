import moment from "moment-timezone";

export function formatDateToMoment(dateTime: number, timezone: string): string {
    const m = moment(dateTime).tz(timezone);
    return m.format("M/D/YYYY") + " at " + m.format("h:mm A");
}

export function adjustDateAndTimeForTimezone(dateStr: string | null | undefined,
                                             timeStr: string | null | undefined,
                                             tz: string | null | undefined) : number | undefined {
    let dateTime;
    if (dateStr && timeStr && tz) {
        let m = moment.tz(dateStr + "T" + timeStr + ":00", tz);
        dateTime = m.valueOf();
    }
    return dateTime;
}