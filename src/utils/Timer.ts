import {Logger} from "@slack/bolt";

export class Timer {
    private start: number;

    constructor() {
        this.start = new Date().getTime();
    }

    startTimer(): void {
        this.start = new Date().getTime();
    }

    getElapsed(): number {
        return new Date().getTime() - this.start;
    }

    logElapsed(message: string, logger: Logger): void {
        logger.info(message + " took " + this.getElapsed() + "ms");
    }
}