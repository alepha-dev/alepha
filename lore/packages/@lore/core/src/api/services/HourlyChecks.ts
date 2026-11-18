import { AlephaError } from "alepha";

/**
 * The checks the hourly job runs (#Q3893): a package registers one per
 * thing it watches over time, Plan its quest reminders, Ship its open-errors
 * threshold. A check does one indexed query for what is due across every
 * project, and never loops over projects or subscriptions.
 */
export class HourlyChecks {
  protected readonly checks = new Map<string, HourlyCheck>();

  public register(check: HourlyCheck): void {
    if (this.checks.has(check.name))
      throw new AlephaError(`Hourly check '${check.name}' is registered twice`);
    this.checks.set(check.name, check);
  }

  public all(): HourlyCheck[] {
    return [...this.checks.values()];
  }
}

export interface HourlyCheck {
  /**
   * `quests.reminders`: the package, then what it checks.
   */
  name: string;
  /**
   * Finds what is due at `now` and acts on it. A check that throws does not
   * stop the others.
   */
  run: (now: string) => Promise<void>;
}
