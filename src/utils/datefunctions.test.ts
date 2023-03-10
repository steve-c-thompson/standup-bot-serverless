import {
    adjustDateAndTimeForTimezone,
    createZeroUtcDate,
    formatDateToPrintableWithTime,
    formatUtcDateToPrintable, getTimezoneOffsetFromIANA
} from "./datefunctions";

const jan1 = new Date(2020, 0, 1, 0, 0, 0, 0);
jan1.setUTCHours(0, 0, 0, 0); // set to UTC midnight

describe('date functions', () => {
    describe('formatDateToPrintableWithTime', () => {
        it('should format a date given a number offset', () => {
            const result = formatDateToPrintableWithTime(jan1.getTime(), -420);
            expect(result).toBe('12/31/2019 at 5:00 PM');
        });
        it('should format a date given a string offset', () => {
            const result = formatDateToPrintableWithTime(jan1.getTime(), 'America/Denver');
            expect(result).toBe('12/31/2019 at 5:00 PM');
        });
    });
    describe('formatUtcDateToPrintable', () => {
       it('should format to M/D/YYYY', () => {
           const result = formatUtcDateToPrintable(jan1.getTime());
           expect(result).toBe('1/1/2020');
       });
    });
    describe('adjustDateAndTimeForTimezone', () => {
       it('should adjust a date and time for a timezone', () => {
           const result = adjustDateAndTimeForTimezone('2019-12-31', '17:00', 'America/Denver');
           expect(result).toBe(jan1.getTime());
       });
    });
    describe('createZeroUtcDate', () => {
       it('should create a date with time set to 0', () => {
           const jan1Local = new Date(2020, 0, 1, 0, 0, 0, 0)
           const result = createZeroUtcDate(jan1Local);
           expect(result.getTime()).toBe(jan1.getTime());
       });
    });
    describe('getTimezoneOffset', () => {
       it('should get the timezone offset', () => {
           const result = getTimezoneOffsetFromIANA('America/Denver');
           expect(result).toBe(-420);
       });
    });
});