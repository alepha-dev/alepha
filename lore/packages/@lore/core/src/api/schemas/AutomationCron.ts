import { AlephaError } from "alepha";
import { type Cron, parseCronExpression } from "cron-schedule";

/**
 * Grammar is the framework's installed parser. Calendar search uses UTC only,
 * including under a host timezone with daylight-saving transitions.
 */
export class AutomationCron {
  protected readonly cache = new Map<string, Cron>();
  public validate(expression: string): string {
    const canonical = expression.trim().split(/\s+/).join(" ");
    if (canonical.split(" ").length !== 5)
      throw new AlephaError("Use a five-field UTC cron expression");
    let parsed: Cron;
    try {
      parsed = parseCronExpression(canonical);
    } catch {
      throw new AlephaError("Invalid UTC cron expression");
    }
    if (parsed.minutes.some((minute) => minute % 5 !== 0))
      throw new AlephaError("Cron minutes must align to five-minute UTC ticks");
    this.search(parsed, new Date("2000-03-01T00:00:00.000Z").getTime(), 1);
    if (this.cache.size >= 64)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(canonical, parsed);
    return canonical;
  }
  public next(expression: string, after: string): string {
    return this.search(this.parse(expression), this.instant(after), 1);
  }
  public latest(expression: string, at: string): string {
    return this.search(this.parse(expression), this.instant(at), -1);
  }
  protected parse(expression: string): Cron {
    const cached = this.cache.get(expression);
    if (cached) return cached;
    return this.cache.get(this.validate(expression))!;
  }
  protected instant(value: string): number {
    const millis = new Date(value).getTime();
    if (!Number.isFinite(millis))
      throw new AlephaError("Invalid UTC schedule instant");
    return millis;
  }
  protected search(cron: Cron, instant: number, direction: 1 | -1): string {
    const start = new Date(instant);
    const midnight = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    );
    const hours = direction === 1 ? cron.hours : cron.reversed.hours;
    const minutes = direction === 1 ? cron.minutes : cron.reversed.minutes;
    // Eight years includes the longest Gregorian leap-day gap. With standard
    // cron day/weekday OR semantics, every possible five-field schedule has
    // an occurrence in this bounded calendar window.
    for (let offset = 0; offset <= 366 * 8; offset += 1) {
      const date = new Date(midnight + direction * offset * 86_400_000);
      if (!cron.months.includes(date.getUTCMonth()) || !this.day(cron, date))
        continue;
      for (const hour of hours)
        for (const minute of minutes) {
          const candidate = date.getTime() + hour * 3_600_000 + minute * 60_000;
          if (direction === 1 ? candidate > instant : candidate <= instant)
            return new Date(candidate).toISOString();
        }
    }
    throw new AlephaError("UTC cron has no possible calendar occurrence");
  }
  protected day(cron: Cron, date: Date): boolean {
    const day = cron.days.includes(date.getUTCDate());
    const weekday = cron.weekdays.includes(date.getUTCDay());
    return cron.days.length === 31
      ? weekday
      : cron.weekdays.length === 7
        ? day
        : day || weekday;
  }
}
