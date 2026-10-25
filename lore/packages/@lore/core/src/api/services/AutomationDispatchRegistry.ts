import { AlephaError } from "alepha";

/**
 * One fixed cron and one shared claim budget. UTC ticks rotate category
 * priority, preserving fairness across cold starts and sustained backlogs.
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
  public async tick(rotation = 0): Promise<number> {
    let claimed = 0;
    const handlers = [...this.handlers.values()];
    const offset = handlers.length ? rotation % handlers.length : 0;
    for (const handler of [
      ...handlers.slice(offset),
      ...handlers.slice(0, offset),
    ]) {
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
