import "dayjs/plugin/relativeTime.js";
import "dayjs/plugin/duration.js";
import "dayjs/plugin/utc.js";
import "dayjs/plugin/timezone.js";
import "dayjs/plugin/localizedFormat.js";
import "dayjs/locale/ar.js";
import "dayjs/locale/fr.js";
import { $hook, $inject, Alepha } from "alepha";
import DayjsApi, { type Dayjs } from "dayjs";
import dayjsDuration from "dayjs/plugin/duration.js";
import dayjsLocalizedFormat from "dayjs/plugin/localizedFormat.js";
import dayjsRelativeTime from "dayjs/plugin/relativeTime.js";
import dayjsTimezone from "dayjs/plugin/timezone.js";
import dayjsUtc from "dayjs/plugin/utc.js";

/**
 * Alepha's date-time unit vocabulary, independent of the date engine.
 */
export type DateTimeUnit =
  | "millisecond"
  | "milliseconds"
  | "ms"
  | "second"
  | "seconds"
  | "s"
  | "minute"
  | "minutes"
  | "m"
  | "hour"
  | "hours"
  | "h"
  | "day"
  | "days"
  | "d"
  | "D"
  | "month"
  | "months"
  | "M"
  | "year"
  | "years"
  | "y"
  | "week"
  | "weeks"
  | "w"
  | "date"
  | "dates"
  | "quarter"
  | "quarters"
  | "Q";

/**
 * Units accepted by duration construction and date arithmetic.
 */
export type DurationUnit = Exclude<
  DateTimeUnit,
  "date" | "dates" | "quarter" | "quarters" | "Q"
>;
type BoundaryUnit = Exclude<DateTimeUnit, "quarter" | "quarters" | "Q">;
export type DateTimeInput = string | number | Date | DateTime;
export type DurationLike = number | Duration | [number, DurationUnit];

/**
 * Keeps the engine entirely behind Alepha's public types.
 */
class DateTimeEngine {
  protected static readonly dates = new WeakMap<DateTime, Dayjs>();
  protected static readonly durations = new WeakMap<
    Duration,
    dayjsDuration.Duration
  >();
  protected static configured = false;

  public static configure(): void {
    if (this.configured) return;
    for (const plugin of [
      dayjsDuration,
      dayjsRelativeTime,
      dayjsUtc,
      dayjsTimezone,
      dayjsLocalizedFormat,
    ])
      DayjsApi.extend(plugin);
    this.configured = true;
  }

  public static parse(value: DateTimeInput | null | undefined): Dayjs {
    return value instanceof DateTime ? this.date(value) : DayjsApi(value);
  }

  public static date(value: DateTime): Dayjs {
    return this.dates.get(value)!;
  }
  public static duration(value: Duration): dayjsDuration.Duration {
    return this.durations.get(value)!;
  }
  public static setDate(value: DateTime, inner: Dayjs): void {
    this.dates.set(value, inner);
  }
  public static setDuration(
    value: Duration,
    inner: dayjsDuration.Duration,
  ): void {
    this.durations.set(value, inner);
  }

  public static wrap(inner: Dayjs): DateTime {
    const value = new DateTime(inner.valueOf());
    this.setDate(value, inner);
    return value;
  }
}

/**
 * Immutable wrapper around the underlying date-time engine.
 *
 * Designed to isolate consumers from the engine in use (currently dayjs).
 * Methods that produce a new value return a new `DateTime` instance.
 */
export class DateTime {
  constructor(value: DateTimeInput = new Date()) {
    DateTimeEngine.configure();
    DateTimeEngine.setDate(this, DateTimeEngine.parse(value));
  }

  /**
   * Add a duration to this date-time.
   */
  add(amount: number, unit?: DurationUnit): DateTime;
  add(duration: Duration): DateTime;
  add(amount: number | Duration, unit?: DurationUnit): DateTime {
    if (amount instanceof Duration) {
      return DateTimeEngine.wrap(
        DateTimeEngine.date(this).add(DateTimeEngine.duration(amount)),
      );
    }
    return DateTimeEngine.wrap(DateTimeEngine.date(this).add(amount, unit));
  }

  /**
   * Subtract a duration from this date-time.
   */
  subtract(amount: number, unit?: DurationUnit): DateTime;
  subtract(duration: Duration): DateTime;
  subtract(amount: number | Duration, unit?: DurationUnit): DateTime {
    if (amount instanceof Duration) {
      return DateTimeEngine.wrap(
        DateTimeEngine.date(this).subtract(DateTimeEngine.duration(amount)),
      );
    }
    return DateTimeEngine.wrap(
      DateTimeEngine.date(this).subtract(amount, unit),
    );
  }

  startOf(unit: BoundaryUnit): DateTime {
    return DateTimeEngine.wrap(DateTimeEngine.date(this).startOf(unit));
  }

  endOf(unit: BoundaryUnit): DateTime {
    return DateTimeEngine.wrap(DateTimeEngine.date(this).endOf(unit));
  }

  isAfter(other: DateTimeInput): boolean {
    return DateTimeEngine.date(this).isAfter(DateTimeEngine.parse(other));
  }

  isBefore(other: DateTimeInput): boolean {
    return DateTimeEngine.date(this).isBefore(DateTimeEngine.parse(other));
  }

  isSame(other: DateTimeInput, unit?: BoundaryUnit): boolean {
    return DateTimeEngine.date(this).isSame(DateTimeEngine.parse(other), unit);
  }

  diff(other: DateTimeInput, unit?: DateTimeUnit): number {
    return DateTimeEngine.date(this).diff(DateTimeEngine.parse(other), unit);
  }

  tz(timezone: string): DateTime {
    return DateTimeEngine.wrap(DateTimeEngine.date(this).tz(timezone));
  }

  locale(lang: string): DateTime {
    return DateTimeEngine.wrap(DateTimeEngine.date(this).locale(lang));
  }

  format(template?: string): string {
    return DateTimeEngine.date(this).format(template);
  }

  fromNow(withoutSuffix?: boolean): string {
    return DateTimeEngine.date(this).fromNow(withoutSuffix);
  }

  toISOString(): string {
    return DateTimeEngine.date(this).toISOString();
  }

  toDate(): Date {
    return DateTimeEngine.date(this).toDate();
  }

  valueOf(): number {
    return DateTimeEngine.date(this).valueOf();
  }

  unix(): number {
    return DateTimeEngine.date(this).unix();
  }

  toJSON(): string {
    return DateTimeEngine.date(this).toISOString();
  }

  toString(): string {
    return DateTimeEngine.date(this).toISOString();
  }
}

/**
 * Immutable wrapper around the underlying duration engine.
 */
export class Duration {
  constructor(value: DurationLike, unit: DurationUnit = "milliseconds") {
    DateTimeEngine.configure();
    DateTimeEngine.setDuration(
      this,
      value instanceof Duration
        ? DateTimeEngine.duration(value)
        : Array.isArray(value)
          ? DayjsApi.duration(value[0], value[1])
          : DayjsApi.duration(value, unit),
    );
  }

  asMilliseconds(): number {
    return DateTimeEngine.duration(this).asMilliseconds();
  }

  asSeconds(): number {
    return DateTimeEngine.duration(this).asSeconds();
  }

  asMinutes(): number {
    return DateTimeEngine.duration(this).asMinutes();
  }

  asHours(): number {
    return DateTimeEngine.duration(this).asHours();
  }

  asDays(): number {
    return DateTimeEngine.duration(this).asDays();
  }

  as(unit: DurationUnit): number {
    return DateTimeEngine.duration(this).as(unit);
  }

  toISOString(): string {
    return DateTimeEngine.duration(this).toISOString();
  }
}

export const isDateTime = (value: unknown): value is DateTime => {
  return value instanceof DateTime;
};

/**
 * The injectable clock. Every service reads time through it - `nowMillis()`,
 * `now()`, `nowISOString()` - instead of `Date.now()`, which is what makes
 * time testable: `pause()` freezes the clock and `travel()` moves it, also
 * releasing `CronProvider` waits so scheduled work can be exercised in tests.
 */
export class DateTimeProvider {
  public static readonly id: string = "alepha.datetime.DateTimeProvider";
  protected locale = "en";
  protected alepha = $inject(Alepha);
  protected ref: DateTime | null = null;
  protected readonly timeouts: Timeout[] = [];
  protected readonly intervals: Interval[] = [];

  /**
   * `setTimeout` takes a 32-bit signed delay (~24.8 days). Node clamps
   * anything larger to 1ms, so an unclamped far-future timer — a monthly
   * cron on the 31st can be 61 days out — fires immediately instead.
   * Longer delays are chained in hops of at most this length.
   */
  protected readonly maxTimerMs = 2147483647;

  constructor() {
    DateTimeEngine.configure();
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
          this.armInterval(interval);
        }),
      );
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => {
      for (const timeout of Array.from(this.timeouts)) {
        this.clearTimeout(timeout);
      }

      for (const interval of this.intervals) {
        // Keep `duration`: it is the period, and a restart re-arms from it.
        // Zeroing it here turned the next `setInterval` into a ~1ms hot loop
        // after a failed start was retried.
        clearInterval(interval.timer);
        interval.timer = null;
        interval.suspended = false;
        interval.elapsed = 0;
      }
    },
  });

  public setLocale(locale: string): void {
    this.locale = locale;
  }

  public isDateTime(value: unknown): value is DateTime {
    return value instanceof DateTime;
  }

  /**
   * Create a new UTC DateTime instance.
   */
  public utc(date: DateTimeInput | null | undefined): DateTime {
    return DateTimeEngine.wrap(
      DayjsApi.utc(DateTimeEngine.parse(date)).locale(this.locale),
    );
  }

  /**
   * Create a new DateTime instance.
   */
  public of(date: DateTimeInput | null | undefined): DateTime {
    if (date instanceof DateTime) return this.withLocale(date);
    return DateTimeEngine.wrap(DateTimeEngine.parse(date).locale(this.locale));
  }

  protected withLocale(date: DateTime): DateTime {
    const inner = DateTimeEngine.date(date);
    return inner.locale() === this.locale
      ? date
      : DateTimeEngine.wrap(inner.locale(this.locale));
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
      return this.withLocale(this.ref);
    }

    return DateTimeEngine.wrap(DayjsApi().locale(this.locale));
  }

  /**
   * Create a new Duration instance.
   */
  public duration = (duration: DurationLike, unit?: DurationUnit): Duration => {
    if (duration instanceof Duration) {
      return duration;
    }

    if (Array.isArray(duration)) {
      return new Duration(duration);
    }

    if (typeof duration === "number") {
      return new Duration(duration, unit || "milliseconds");
    }

    return duration;
  };

  public isDurationLike(value: unknown): value is DurationLike {
    try {
      return DayjsApi.isDuration(
        DateTimeEngine.duration(this.duration(value as DurationLike)),
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
   *
   * `options.now` anchors the duration at an earlier instant: the wait
   * resolves at `now + duration`, however far in the past `now` is. An
   * already-elapsed expiry resolves immediately.
   */
  public wait(
    duration: DurationLike,
    options: {
      signal?: AbortSignal;
      now?: number;
    } = {},
  ): Promise<void> {
    return new Promise((resolve) => {
      let onAbort: (() => void) | undefined;

      const timeout = this.createTimeout(
        () => {
          if (options.signal && onAbort) {
            options.signal.removeEventListener("abort", onAbort);
          }
          resolve();
        },
        duration,
        options.now,
      );

      // An already-elapsed deadline (an anchored `now` in the past) fires the
      // callback synchronously inside createTimeout, before `onAbort` exists.
      // Registering a listener afterwards would never be removed, and a
      // cron-style caller anchoring every tick leaked one per call.
      if (options.signal && timeout.duration > 0) {
        onAbort = () => {
          this.clearTimeout(timeout);
          resolve();
        };
        options.signal.addEventListener("abort", onAbort);
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
      this.armInterval(interval);
    }

    return interval;
  }

  /**
   * Arms `interval.timer`. Periods within the 32-bit `setTimeout` limit use
   * a plain `setInterval`; longer ones are chained in hops (`setInterval`
   * clamps oversized delays to ~1ms just like `setTimeout`, spinning the
   * handler continuously). Chained periods re-arm only after the handler
   * settles, which is indistinguishable at multi-week scale.
   */
  protected armInterval(interval: Interval): void {
    if (interval.duration <= this.maxTimerMs) {
      interval.timer = setInterval(interval.run, interval.duration);
      return;
    }

    const hop = (remaining: number): void => {
      if (remaining > this.maxTimerMs) {
        interval.timer = setTimeout(
          () => hop(remaining - this.maxTimerMs),
          this.maxTimerMs,
        );
        return;
      }

      interval.timer = setTimeout(async () => {
        await interval.run();
        // `clearInterval` / `travel()` null the handle to suspend the
        // interval — do not re-arm once that has happened.
        if (interval.timer != null) {
          hop(interval.duration);
        }
      }, remaining);
    };

    hop(interval.duration);
  }

  /**
   * Run a callback after a certain duration.
   *
   * `options.unref` arms the timer without holding the event loop open, for a
   * callback that only tidies up: a cache eviction, a lock expiry. Refed is
   * the right default — a timeout carrying real work must keep the process
   * alive until it has run — but a housekeeping timer that does is a process
   * that will not exit, and the wait is as long as the TTL. A 5-minute cache
   * TTL kept `lore quality push` alive for 5 minutes after its work,
   * once per CI run, delaying every deploy gated on it.
   */
  public createTimeout(
    callback: () => void,
    duration: DurationLike,
    now?: number,
    options?: TimeoutOptions,
  ): Timeout {
    if (now) {
      // `now` anchors the duration at an earlier instant: the expiry is
      // `now + duration`, and only the REMAINING time from the current
      // instant is actually waited. Honoring it on the real clock matters as
      // much as under a paused one — `CronProvider` anchors every tick at
      // the previous scheduled tick, and waiting the full interval from the
      // call instant instead lets scheduling lateness accumulate tick after
      // tick, drifting the whole cron grid off its wall-clock alignment.
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

      // Still in the future. This used to return an unregistered dummy under
      // a paused clock, so `travel()` past the expiry never fired it and
      // `wait(d, { now })` hung forever — stalling any paused-clock cron
      // chain. Register it against the REMAINING time instead.
      return this.createTimeout(callback, remaining, undefined, options);
    }

    const timeout: Timeout = {
      now: now ?? this.now().valueOf(),
      duration: this.duration(duration).asMilliseconds(),
      callback,
      // ⚠️ Carried on the timeout, not held in this call: `travel()` re-arms a
      // not-yet-due timer through `registerTimer`, and a flag that lived only
      // in the argument would silently ref it again on the way through.
      unref: options?.unref,
      clear: () => this.clearTimeout(timeout),
    };

    this.registerTimer(timeout, timeout.duration, () => {
      const index = this.timeouts.indexOf(timeout);
      if (index !== -1) {
        this.timeouts.splice(index, 1);
      }
      timeout.callback();
    });

    this.timeouts.push(timeout);

    return timeout;
  }

  /**
   * Arms `timeout.timer` to run `fire` after `remaining` ms, chaining hops
   * of at most `maxTimerMs` so far-future delays survive the 32-bit
   * `setTimeout` limit. Each hop reassigns `timeout.timer`, so
   * `clearTimeout` and `travel()` always see the live handle. The chain
   * never mutates `timeout.now` / `timeout.duration` — `travel()` owns that
   * bookkeeping.
   */
  protected registerTimer(
    timeout: Timeout,
    remaining: number,
    fire: () => void,
  ): void {
    if (remaining <= this.maxTimerMs) {
      timeout.timer = setTimeout(fire, remaining);
      this.applyUnref(timeout);
      return;
    }

    timeout.timer = setTimeout(() => {
      this.registerTimer(timeout, remaining - this.maxTimerMs, fire);
    }, this.maxTimerMs);
    this.applyUnref(timeout);
  }

  /**
   * Drop the event-loop reference of `timeout.timer` when the timeout asked
   * for it.
   *
   * Every hop of a chained far-future timer goes through here: unref is a
   * property of the handle, so a new hop is refed again unless it is reapplied.
   *
   * Both optional calls are load-bearing rather than defensive. `setTimeout`
   * returns a plain number in the browser and in workerd, where there is no
   * handle to unref and nothing to keep alive either.
   */
  protected applyUnref(timeout: Timeout): void {
    if (timeout.unref) {
      timeout.timer?.unref?.();
    }
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
    unit?: DurationUnit,
  ): Promise<void> {
    this.ref = this.ref || this.now();
    const ms = this.duration(duration, unit).asMilliseconds();
    const now = this.nowMillis();
    this.ref = this.ref.add(this.duration(duration, unit));

    const due: Timeout[] = [];

    for (const timeout of Array.from(this.timeouts)) {
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
        due.push(timeout);
      } else {
        this.registerTimer(timeout, timeout.duration, () => {
          const index = this.timeouts.indexOf(timeout);
          if (index !== -1) {
            this.timeouts.splice(index, 1);
          }
          timeout.callback();
        });
      }
    }

    // Fire in expiry order, not creation order — real timers do the same.
    // Every remaining duration shares the same base instant, so the most
    // negative one is the earliest expiry. The sort is stable: same-expiry
    // timeouts keep their creation order.
    due.sort((a, b) => a.duration - b.duration);
    for (const timeout of due) {
      timeout.callback();
    }

    for (const interval of this.intervals) {
      // A live timer, or one this method already suspended on a previous
      // call: both keep firing through travel(). Only a stopped interval is
      // skipped.
      if (!interval.timer && !interval.suspended) {
        continue;
      }

      clearInterval(interval.timer);

      // Travelled time that did not complete a period is carried, not lost:
      // three travel([20, "minutes"]) calls owe a 30-minute interval two
      // ticks, and flooring each call in isolation delivered none of them.
      const elapsed = (interval.elapsed ?? 0) + ms;
      const repeat = Math.floor(elapsed / interval.duration);
      interval.elapsed = elapsed - repeat * interval.duration;

      for (let i = 0; i < repeat; i++) {
        await interval.run();
      }

      // Keep the interval suspended: from now on it fires through travel()
      // only, which is what keeps a test deterministic. reset() undoes this.
      interval.timer = null;
      interval.suspended = true;
    }

    await this.tick();
  }

  /**
   * Stop the time.
   */
  public pause(): DateTime {
    this.ref = this.ref || this.now();
    return this.withLocale(this.ref);
  }

  /**
   * Reset the reference date.
   */
  public reset(): void {
    this.ref = null;

    // Give every interval travel() took over back to the real clock, or a
    // suspended one would stay dead for the rest of the process. The carried
    // remainder is dropped rather than shortening the first real period: the
    // clock has just jumped BACK to now, so travelled progress toward the
    // next tick no longer describes any elapsed time.
    for (const interval of this.intervals) {
      if (!interval.suspended) {
        continue;
      }

      interval.suspended = false;
      interval.elapsed = 0;
      this.armInterval(interval);
    }
  }
}

export interface Interval {
  timer?: any;
  duration: number;
  run: () => unknown;
  /**
   * Set once travel() has taken over the interval: there is no live timer,
   * but the interval still fires on every later travel() call. Cleared by
   * reset(), which hands the interval back to the real clock.
   */
  suspended?: boolean;
  /**
   * Travelled milliseconds that did not complete a period, carried to the
   * next travel() call so short hops still add up to a tick.
   */
  elapsed?: number;
}

export interface Timeout {
  now: number;
  timer?: any;
  duration: number;
  callback: () => void;
  unref?: boolean;
  clear: () => void;
}

/**
 * Options for {@link DateTimeProvider.createTimeout}.
 */
export interface TimeoutOptions {
  /**
   * Arm the timer without holding the event loop open.
   *
   * For housekeeping only — an eviction, an expiry — never for a callback
   * whose work must happen before the process may exit.
   */
  unref?: boolean;
}
