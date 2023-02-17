import moment from "moment-timezone";

export function formatDateToPrintableWithTime(dateTime: number | string, timezone: number | string): string {
    let m;
    if (typeof timezone === "string") {
        m = moment(dateTime).tz(timezone);
    } else {
        m = moment(dateTime).utcOffset(timezone);
    }
    return m.format("M/D/YYYY") + " at " + m.format("h:mm A");
}

export function formatUtcDateToPrintable(dateTime: number): string {
    const m = moment.utc(dateTime);

    return m.format("M/D/YYYY");
}

export function adjustDateAndTimeForTimezone(dateStr: string | null | undefined,
                                             timeStr: string | null | undefined,
                                             tz: string | null | undefined): number | undefined {
    let dateTime;
    if (dateStr && timeStr && tz) {
        let m = moment.tz(dateStr + "T" + timeStr + ":00", tz);
        dateTime = m.valueOf();
    }
    return dateTime;
}

export function createZeroUtcDate(date: Date): Date {
    const d = new Date(date.getTime());
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

export function getTimezoneOffset(timezone: string): number {
    return moment.tz(timezone).utcOffset();
}