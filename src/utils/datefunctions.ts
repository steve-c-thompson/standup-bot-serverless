import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 *
 * @param dateTime
 * @param timezone number offset (minutes) or string timezone
 */
export function formatDateToPrintableWithTime(dateTime: number | string, timezone: number | string): string {
    let m;
    if (typeof timezone === "string") {
        m = dayjs(dateTime).tz(timezone);
    } else {
        m = dayjs(dateTime).utcOffset(timezone);
    }
    return m.format("M/D/YYYY") + " at " + m.format("h:mm A");
}

export function formatUtcDateToPrintable(dateTime: number): string {
    return dayjs(dateTime).tz("UTC").format("M/D/YYYY");
}

/**
 * Adjusts a date and time for a timezone
 * @param dateStr YYYY-MM-DD
 * @param timeStr HH:mm
 * @param tz timezone
 * @return an instant in time or undefined if all values are not passed
 */
export function adjustDateAndTimeForTimezone(dateStr: string | null | undefined,
                                             timeStr: string | null | undefined,
                                             tz: string | null | undefined): number | undefined {
    let dateTime;
    if (dateStr && timeStr && tz) {
        let m = dayjs.tz(dateStr + " " + timeStr + ":00", tz);
        dateTime = m.valueOf();
    }
    return dateTime;
}

export function createZeroUtcDate(date: Date): Date {
    const d = new Date(date.getTime());
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

export function getTimezoneOffsetFromIANA(timezone: string): number {
    return dayjs().tz(timezone).utcOffset();
}