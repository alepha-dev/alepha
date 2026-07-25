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
  type OpUnitType,
  type PluginFunc,
  type QUnitType,
} from "dayjs";
import dayjsDuration, { type DurationUnitType } from "dayjs/plugin/duration.js";
import dayjsLocalizedFormat from "dayjs/plugin/localizedFormat.js";
import dayjsRelativeTime from "dayjs/plugin/relativeTime.js";
import dayjsTimezone from "dayjs/plugin/timezone.js";
import dayjsUtc from "dayjs/plugin/utc.js";

export type { DurationUnitType, ManipulateType, OpUnitType, QUnitType };

export type DateTimeInput = string | number | Date | DateTime | Dayjs;

export type DurationLike = number | Duration | [number, ManipulateType];

/**
 * Immutable wrapper around the underlying date-time engine.
 *
 * Designed to isolate consumers from the engine in use (currently dayjs).
 * Methods that produce a new value return a new `DateTime` instance.
 */
export class DateTime {
  protected readonly inner: Dayjs;

  constructor(inner: Dayjs) {
    this.inner = inner;
  }

  /**
   * Add a duration to this date-time.
   */
  add(amount: number, unit?: ManipulateType): DateTime;
  add(duration: Duration): DateTime;
  add(amount: number | Duration, unit?: ManipulateType): DateTime {
    if (amount instanceof Duration) {
      return new DateTime(this.inner.add(amount.toDayjs()));
    }
    return new DateTime(this.inner.add(amount, unit));
  }

  /**
   * Subtract a duration from this date-time.
   */
  subtract(amount: number, unit?: ManipulateType): DateTime;
  subtract(duration: Duration): DateTime;
  subtract(amount: number | Duration, unit?: ManipulateType): DateTime {
    if (amount instanceof Duration) {
      return new DateTime(this.inner.subtract(amount.toDayjs()));
    }
    return new DateTime(this.inner.subtract(amount, unit));
  }

  startOf(unit: OpUnitType): DateTime {
    return new DateTime(this.inner.startOf(unit));
  }

  endOf(unit: OpUnitType): DateTime {
    return new DateTime(this.inner.endOf(unit));
  }

  isAfter(other: DateTimeInput): boolean {
    return this.inner.isAfter(toDayjs(other));
  }

  isBefore(other: DateTimeInput): boolean {
    return this.inner.isBefore(toDayjs(other));
  }

  isSame(other: DateTimeInput, unit?: OpUnitType): boolean {
    return this.inner.isSame(toDayjs(other), unit);
  }

  diff(other: DateTimeInput, unit?: QUnitType | OpUnitType): number {
    return this.inner.diff(toDayjs(other), unit);
  }

  tz(timezone: string): DateTime {
    return new DateTime(this.inner.tz(timezone));
  }

  locale(lang: string): DateTime {
    return new DateTime(this.inner.locale(lang));
  }

  format(template?: string): string {
    return this.inner.format(template);
  }

  fromNow(withoutSuffix?: boolean): string {
    return this.inner.fromNow(withoutSuffix);
  }

  toISOString(): string {
    return this.inner.toISOString();
  }

  toDate(): Date {
    return this.inner.toDate();
  }

  valueOf(): number {
    return this.inner.valueOf();
  }

  unix(): number {
    return this.inner.unix();
  }

  toJSON(): string {
    return this.inner.toISOString();
  }

  toString(): string {
    return this.inner.toISOString();
  }

  /**
   * Escape hatch for the underlying dayjs instance.
   *
   * Use sparingly — anything calling this becomes coupled to dayjs and
   * will need to migrate when the engine is replaced.
   */
  toDayjs(): Dayjs {
    return this.inner;
  }
}

/**
 * Immutable wrapper around the underlying duration engine.
 */
export class Duration {
  protected readonly inner: dayjsDuration.Duration;

  constructor(inner: dayjsDuration.Duration) {
    this.inner = inner;
  }

  asMilliseconds(): number {
    return this.inner.asMilliseconds();
  }

  asSeconds(): number {
    return this.inner.asSeconds();
  }

  asMinutes(): number {
    return this.inner.asMinutes();
  }

  asHours(): number {
    return this.inner.asHours();
  }

  asDays(): number {
    return this.inner.asDays();
  }

  as(unit: DurationUnitType): number {
    return this.inner.as(unit);
  }

  toISOString(): string {
    return this.inner.toISOString();
  }

  /**
   * Escape hatch for the underlying dayjs duration.
   */
  toDayjs(): dayjsDuration.Duration {
    return this.inner;
  }
}

export const isDateTime = (value: unknown): value is DateTime => {
  return value instanceof DateTime;
};

const toDayjs = (value: DateTimeInput): Dayjs => {
  if (value instanceof DateTime) {
    return value.toDayjs();
  }
  return DayjsApi(value as any);
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
      DayjsApi.extend(plugin);
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
      for (const timeout of [...this.timeouts]) {
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
    DayjsApi.locale(locale);
  }

  public isDateTime(value: unknown): value is DateTime {
    return value instanceof DateTime;
  }

  /**
   * Create a new UTC DateTime instance.
   */
  public utc(date: DateTimeInput | null | undefined): DateTime {
    return new DateTime(DayjsApi.utc(unwrap(date)));
  }

  /**
   * Create a new DateTime instance.
   */
  public of(date: DateTimeInput | null | undefined): DateTime {
    if (date instanceof DateTime) {
      return date;
    }
    return new DateTime(DayjsApi(date as any));
  }

  /**
   * Get the current date as a string.
   */
  public toISOString(date: DateTimeInput = this.now()): string {
    return this.of(date).toISOString();
  }

  /**
   * Get the current date.
   */
  public now(): DateTime {
    return this.getCurrentDate();
  }

  /**
   * Get the current date as a string.
   *
   * This is much faster than `DateTimeProvider.now().toISOString()` as it avoids creating a DateTime instance.
   */
  public nowISOString(): string {
    if (this.ref) {
      return this.ref.toISOString();
    }
    return new Date().toISOString();
  }

  /**
   * Get the current date as milliseconds since epoch.
   *
   * This is much faster than `DateTimeProvider.now().valueOf()` as it avoids creating a DateTime instance.
   */
  public nowMillis(): number {
    if (this.ref) {
      return this.ref.valueOf();
    }
    return Date.now();
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

    return new DateTime(DayjsApi());
  }

  /**
   * Create a new Duration instance.
   */
  public duration = (
    duration: DurationLike,
    unit?: ManipulateType,
  ): Duration => {
    if (duration instanceof Duration) {
      return duration;
    }

    if (Array.isArray(duration)) {
      return new Duration(DayjsApi.duration(duration[0], duration[1]));
    }

    if (typeof duration === "number") {
      return new Duration(DayjsApi.duration(duration, unit || "milliseconds"));
    }

    return duration;
  };

  public isDurationLike(value: unknown): value is DurationLike {
    try {
      return DayjsApi.isDuration(
        this.duration(value as DurationLike).toDayjs(),
      );
    } catch {
      return false;
    }
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
    duration: DurationLike,
    start = false,
  ): Interval {
    const interval: Interval = {
      run,
      duration: this.duration(duration).asMilliseconds(),
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
      // Replaying a timer that was created at an earlier virtual instant
      // (`now`) under a paused or travelled clock.
      const next = this.of(now).add(this.duration(duration));
      const remaining = next.valueOf() - this.now().valueOf();

      // `<=`, not `<`: an expiry landing exactly on the current instant has
      // elapsed and must fire.
      if (remaining <= 0) {
        callback();
        return {
          now,
          duration: 0,
          callback: () => {},
          clear: () => {},
        };
      }

      // Still in the future. This used to return an unregistered dummy, so
      // `travel()` past the expiry never fired it and `wait(d, { now })` hung
      // forever — stalling any paused-clock cron chain
      // (`CronProvider` is a production caller). Register it against the
      // REMAINING virtual time instead.
      return this.createTimeout(callback, remaining);
    }

    const timeout: Timeout = {
      now: now ?? this.now().valueOf(),
      duration: this.duration(duration).asMilliseconds(),
      callback,
      clear: () => this.clearTimeout(timeout),
    };

    timeout.timer = setTimeout(() => {
      const index = this.timeouts.indexOf(timeout);
      if (index !== -1) {
        this.timeouts.splice(index, 1);
      }
      timeout.callback();
    }, timeout.duration);

    this.timeouts.push(timeout);

    return timeout;
  }

  public clearTimeout(timeout: Timeout): void {
    clearTimeout(timeout.timer);
    timeout.duration = 0;
    timeout.timer = null;
    const index = this.timeouts.indexOf(timeout);
    if (index !== -1) {
      this.timeouts.splice(index, 1);
    }
  }

  public clearInterval(interval: Interval): void {
    clearInterval(interval.timer);
    interval.duration = 0;
    interval.timer = null;
    const index = this.intervals.indexOf(interval);
    if (index !== -1) {
      this.intervals.splice(index, 1);
    }
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
    const ms = this.duration(duration, unit).asMilliseconds();
    const now = this.nowMillis();
    this.ref = this.ref.add(this.duration(duration, unit));

    for (const timeout of [...this.timeouts]) {
      if (!timeout.timer) {
        continue;
      }

      clearTimeout(timeout.timer);
      timeout.timer = null;

      const spent = now - timeout.now;
      timeout.duration = timeout.duration - spent - ms;
      // Re-baseline so the next travel() doesn't count this elapsed time again.
      timeout.now = now + ms;

      if (timeout.duration <= 0) {
        const index = this.timeouts.indexOf(timeout);
        if (index !== -1) {
          this.timeouts.splice(index, 1);
        }
        timeout.callback();
      } else {
        timeout.timer = setTimeout(() => {
          const index = this.timeouts.indexOf(timeout);
          if (index !== -1) {
            this.timeouts.splice(index, 1);
          }
          timeout.callback();
        }, timeout.duration);
      }
    }

    for (const interval of this.intervals) {
      if (!interval.timer) {
        continue;
      }

      clearInterval(interval.timer);

      const repeat = Math.floor(ms / interval.duration);
      for (let i = 0; i < repeat; i++) {
        await interval.run();
      }

      // Keep intervals suspended — they only fire during travel() calls
      interval.timer = null;
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

const unwrap = (value: DateTimeInput | null | undefined): any => {
  if (value instanceof DateTime) {
    return value.toDayjs();
  }
  return value;
};

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
