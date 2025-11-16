import "dayjs/plugin/relativeTime.js";
import "dayjs/plugin/duration.js";
import "dayjs/plugin/utc.js";
import "dayjs/plugin/timezone.js";
import "dayjs/plugin/localizedFormat.js";
import "dayjs/locale/ar.js";
import "dayjs/locale/fr.js";
import { $hook, $inject, Alepha } from "alepha";
import DayjsApi, {
  type Dayjs,
  type ManipulateType,
  type PluginFunc,
} from "dayjs";
import dayjsDuration from "dayjs/plugin/duration.js";
import dayjsLocalizedFormat from "dayjs/plugin/localizedFormat.js";
import dayjsRelativeTime from "dayjs/plugin/relativeTime.js";
import dayjsTimezone from "dayjs/plugin/timezone.js";
import dayjsUtc from "dayjs/plugin/utc.js";

export type DateTime = DayjsApi.Dayjs;
export type Duration = dayjsDuration.Duration;
export type DurationLike =
  | number
  | dayjsDuration.Duration
  | [number, ManipulateType];

export const dayjs = DayjsApi;
export const isDateTime = (value: unknown): value is DateTime => {
  return dayjs.isDayjs(value);
};

export class DateTimeProvider {
  public static PLUGINS: Array<PluginFunc<any>> = [
    dayjsDuration,
    dayjsRelativeTime,
    dayjsUtc,
    dayjsTimezone,
    dayjsLocalizedFormat,
  ];

  protected alepha = $inject(Alepha);
  protected ref: DateTime | null = null;
  protected readonly timeouts: Timeout[] = [];
  protected readonly intervals: Interval[] = [];

  constructor() {
    for (const plugin of DateTimeProvider.PLUGINS) {
      dayjs.extend(plugin);
    }
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // we start intervals now but first tick will be rejected as App is not ready yet
      await Promise.all(
        this.intervals.map(async (interval) => {
          if (interval.timer != null) {
            return;
          }
          await interval.run();
          interval.timer = setInterval(interval.run, interval.duration);
        }),
      );
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => {
      for (const timeout of this.timeouts) {
        this.clearTimeout(timeout);
      }

      for (const interval of this.intervals) {
        clearInterval(interval.timer);
        interval.duration = 0;
        interval.timer = null;
      }
    },
  });

  public setLocale(locale: string): void {
    dayjs.locale(locale);
  }

  public isDateTime(value: unknown): value is DateTime {
    return dayjs.isDayjs(value);
  }

  /**
   * Create a new UTC DateTime instance.
   */
  public utc(
    date: string | number | Date | Dayjs | null | undefined,
  ): DateTime {
    return dayjs.utc(date);
  }

  /**
   * Create a new DateTime instance.
   */
  public of(date: string | number | Date | Dayjs | null | undefined): DateTime {
    return dayjs(date);
  }

  /**
   * Get the current date.
   */
  public now(): DateTime {
    return this.of(this.getCurrentDate());
  }

  /**
   * Get the current date as a string.
   *
   * @param date
   */
  public toISOString(date: Date | string | DateTime = this.now()): string {
    return this.of(date).toISOString();
  }

  /**
   * Get the current date as a string.
   */
  public nowISOString(): string {
    return this.toISOString();
  }

  /**
   * Get the current date as a string.
   *
   * @protected
   */
  protected getCurrentDate(): DateTime {
    if (this.ref) {
      return this.ref;
    }

    return dayjs();
  }

  /**
   * Create a new Duration instance.
   */
  public duration = (
    duration: DurationLike,
    unit?: ManipulateType,
  ): Duration => {
    if (Array.isArray(duration)) {
      return dayjs.duration(duration[0], duration[1]);
    }

    if (typeof duration === "number") {
      return dayjs.duration(duration, unit || "milliseconds");
    }

    return duration;
  };

  public isDurationLike(value: unknown): value is DurationLike {
    return dayjs.isDuration(this.duration(value as DurationLike));
  }

  // -------------------------------------------------------------------------------------------------------------------

  // Timer Management

  /**
   * Return a promise that resolves after the next tick.
   * It uses `setTimeout` with 0 ms delay.
   */
  public async tick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Wait for a certain duration.
   *
   * You can clear the timeout by using the `AbortSignal` API.
   * Aborted signal will resolve the promise immediately, it does not reject it.
   */
  public wait(
    duration: DurationLike,
    options: {
      signal?: AbortSignal;
      now?: number;
    } = {},
  ): Promise<void> {
    return new Promise((resolve) => {
      let clearTimeout: any;
      let callback: any;

      const timeout = this.createTimeout(
        () => {
          if (options.signal && clearTimeout) {
            options.signal.removeEventListener("abort", callback);
          }
          resolve();
        },
        duration,
        options.now,
      );

      if (options.signal) {
        clearTimeout = () => this.clearTimeout(timeout);
        callback = () => {
          clearTimeout();
          resolve();
        };
        options.signal.addEventListener("abort", callback);
      }
    });
  }

  public createInterval(
    run: () => unknown,
    distance: DurationLike,
    start = false,
  ): Interval {
    const interval: Interval = {
      run,
      duration: this.duration(distance).asMilliseconds(),
    };

    this.intervals.push(interval);

    if (start) {
      interval.timer = setInterval(interval.run, interval.duration);
    }

    return interval;
  }

  /**
   * Run a callback after a certain duration.
   */
  public createTimeout(
    callback: () => void,
    duration: DurationLike,
    now?: number,
  ): Timeout {
    if (this.ref && now) {
      const next = this.of(now).add(this.duration(duration));
      if (next < this.now()) {
        callback();
      }
      return {
        now,
        duration: 0,
        callback: () => {},
        clear: () => {},
      };
    }

    const timeout: Timeout = {
      now: now ?? this.now().valueOf(),
      duration: this.duration(duration).asMilliseconds(),
      callback,
      clear: () => this.clearTimeout(timeout),
    };

    timeout.timer = setTimeout(() => {
      timeout.callback();
    }, timeout.duration);

    this.timeouts.push(timeout);

    return timeout;
  }

  public clearTimeout(timeout: Timeout): void {
    clearTimeout(timeout.timer);
    timeout.duration = 0;
    timeout.timer = null;
  }

  public clearInterval(interval: Interval): void {
    clearInterval(interval.timer);
    interval.duration = 0;
    interval.timer = null;
  }

  /**
   * Run a function with a deadline.
   */
  public async deadline<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    duration: DurationLike,
  ): Promise<T> {
    const abort = new AbortController();
    const timeout = this.createTimeout(() => abort.abort(), duration);
    try {
      return await fn(abort.signal);
    } finally {
      this.clearTimeout(timeout);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  // Testing

  /**
   * Add time to the current date.
   */
  public async travel(
    duration: DurationLike,
    unit?: ManipulateType,
  ): Promise<void> {
    this.ref = this.ref || this.now();
    this.ref = this.ref.add(this.duration(duration, unit));
    const ms = this.duration(duration, unit).asMilliseconds();
    const now = Date.now();

    for (const timeout of this.timeouts) {
      if (!timeout.timer) {
        continue;
      }

      clearTimeout(timeout.timer);
      timeout.timer = null;

      const spent = now - timeout.now;
      timeout.duration = timeout.duration - spent - ms;

      if (timeout.duration <= 0) {
        timeout.callback();
      } else {
        timeout.timer = setTimeout(() => {
          timeout.callback();
        }, timeout.duration);
      }
    }

    for (const interval of this.intervals) {
      if (!interval.timer) {
        continue;
      }

      clearInterval(interval.timer);
      interval.timer = null;

      const repeat = Math.floor(ms / interval.duration);
      for (let i = 0; i < repeat; i++) {
        await interval.run();
      }
    }

    await this.tick();
  }

  /**
   * Stop the time.
   */
  public pause(): DateTime {
    this.ref = this.ref || this.now();
    return this.ref;
  }

  /**
   * Reset the reference date.
   */
  public reset(): void {
    this.ref = null;
  }
}

export interface Interval {
  timer?: any;
  duration: number;
  run: () => unknown;
}

export interface Timeout {
  now: number;
  timer?: any;
  duration: number;
  callback: () => void;
  clear: () => void;
}
