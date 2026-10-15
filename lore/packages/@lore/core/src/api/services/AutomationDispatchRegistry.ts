import { AlephaError } from "alepha";

/**
 * One fixed cron, one shared claim budget. Recoveries run before new events
 * and schedules so a crash cannot strand a lease or starve its continuation.
 */
export class AutomationDispatchRegistry {
  protected readonly handlers = new Map<
    string,
    (limit: number) => Promise<number>
  >();
  public register(
    key: string,
    handler: (limit: number) => Promise<number>,
  ): void {
    if (this.handlers.has(key))
      throw new AlephaError(`Duplicate automation dispatcher '${key}'`);
    this.handlers.set(key, handler);
  }
  public async tick(): Promise<number> {
    let claimed = 0;
    for (const handler of this.handlers.values()) {
      if (claimed >= 50) break;
      const count = await handler(50 - claimed);
      if (!Number.isSafeInteger(count) || count < 0 || count > 50 - claimed)
        throw new AlephaError(
          "Automation dispatcher exceeded the 50-claim tick budget",
        );
      claimed += count;
    }
    return claimed;
  }
}
