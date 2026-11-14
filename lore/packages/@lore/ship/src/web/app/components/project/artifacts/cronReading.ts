/**
 * A cron expression read aloud, as an i18n key and its arguments, or
 * `undefined` for one this does not recognise.
 *
 * ⚠️ Deliberately small. It reads the shapes a build actually declares
 * (every N minutes, hourly, daily, weekly, monthly) and says nothing about
 * the rest: the expression is always printed beside the reading, so an
 * unread one costs a blank, and a wrong reading would cost trust in all of
 * them. Lists, ranges and month names are left unread for that reason.
 *
 * Times are UTC, which is what the runtimes fire them in.
 */
export interface CronReading {
  key:
    | "artifact.manifest.cron.everyMinute"
    | "artifact.manifest.cron.everyMinutes"
    | "artifact.manifest.cron.hourlyAt"
    | "artifact.manifest.cron.everyHours"
    | "artifact.manifest.cron.dailyAt"
    | "artifact.manifest.cron.weeklyAt"
    | "artifact.manifest.cron.monthlyAt";
  args: string[];
  /**
   * For `weeklyAt`: the day, 0 for Sunday. The caller names it in the
   * reader's language and puts it first in `args`.
   */
  weekday?: number;
}

const NUMBER = /^\d+$/;
const STEP = /^\*\/(\d+)$/;

const clock = (hour: string, minute: string): string =>
  `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

export const cronReading = (expression: string): CronReading | undefined => {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minute, hour, day, month, weekday] = fields;
  if (month !== "*") return undefined;
  const anyDay = day === "*" && weekday === "*";

  if (anyDay && hour === "*") {
    if (minute === "*") {
      return { key: "artifact.manifest.cron.everyMinute", args: [] };
    }
    const step = STEP.exec(minute);
    if (step) {
      return step[1] === "1"
        ? { key: "artifact.manifest.cron.everyMinute", args: [] }
        : { key: "artifact.manifest.cron.everyMinutes", args: [step[1]] };
    }
    if (NUMBER.test(minute)) {
      return { key: "artifact.manifest.cron.hourlyAt", args: [minute] };
    }
    return undefined;
  }

  if (!NUMBER.test(minute)) return undefined;

  const hours = STEP.exec(hour);
  if (anyDay && hours) {
    return {
      key: "artifact.manifest.cron.everyHours",
      args: [hours[1], minute],
    };
  }

  if (!NUMBER.test(hour)) return undefined;
  const at = clock(hour, minute);

  if (anyDay) {
    return { key: "artifact.manifest.cron.dailyAt", args: [at] };
  }
  if (day === "*" && NUMBER.test(weekday) && Number(weekday) <= 7) {
    return {
      key: "artifact.manifest.cron.weeklyAt",
      args: [at],
      weekday: Number(weekday) % 7,
    };
  }
  if (weekday === "*" && NUMBER.test(day)) {
    return { key: "artifact.manifest.cron.monthlyAt", args: [day, at] };
  }
  return undefined;
};
