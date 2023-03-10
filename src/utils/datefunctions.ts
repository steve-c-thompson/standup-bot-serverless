import moment from "moment-timezone";
import {getTimezoneOffset, zonedTimeToUtc, format, formatInTimeZone, utcToZonedTime} from 'date-fns-tz'

/**
 *
 * @param dateTime
 * @param timezone number offset (minutes) or string timezone
 */
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
    // const m = moment.utc(dateTime);
    const date = new Date(dateTime);

    return formatInTimeZone(date, "UTC", "M/d/yyyy");
}

/**
 * Adjusts a date and time for a timezone
 * @param dateStr YYYY-MM-DD
 * @param timeStr HH:mm
 * @param tz timezone
 */
export function adjustDateAndTimeForTimezone(dateStr: string | null | undefined,
                                             timeStr: string | null | undefined,
                                             tz: string | null | undefined): number | undefined {
    let dateTime;
    if (dateStr && timeStr && tz) {
        let m = zonedTimeToUtc(dateStr + "T" + timeStr + ":00", tz);
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
    return getTimezoneOffset(timezone) / 1000 / 60;
}