import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { QueueProvider, type QueuePushOptions } from "./QueueProvider.ts";

/**
 * One queued message, plus the moment it becomes deliverable.
 */
export interface MemoryQueueEntry {
  message: string;
  dueAt: number;
}

// `extends`, not `implements` — otherwise this misses default members added
// to the base class (it silently lost `pushMany` that way).
export class MemoryQueueProvider extends QueueProvider {
  protected readonly log = $logger();
  protected readonly dt = $inject(DateTimeProvider);
  protected queueList: Record<string, MemoryQueueEntry[]> = {};

  /**
   * Takes ONE message, not a rest parameter.
   *
   * It used to be variadic, which read as a convenience and was in fact a
   * trap: the base class declares `push(queue, message, options?)`, so the
   * third argument of a variadic override is another message. Adding
   * `options` to the interface would have silently enqueued the option bag
   * as a message here.
   */
  public async push(
    queue: string,
    message: string,
    options?: QueuePushOptions,
  ): Promise<void> {
    if (this.queueList[queue] == null) {
      this.queueList[queue] = [];
    }

    const delayMs = Math.max(0, (options?.delaySeconds ?? 0) * 1000);
    this.queueList[queue].push({
      message,
      dueAt: this.dt.nowMillis() + delayMs,
    });
  }

  public override async pushMany(
    queue: string,
    messages: string[],
    options?: QueuePushOptions,
  ): Promise<void> {
    for (const message of messages) {
      await this.push(queue, message, options);
    }
  }

  /**
   * Returns the oldest message that is DUE, skipping over any that are not.
   *
   * Skipping rather than head-blocking is deliberate: one delayed message
   * must not hold back the undelayed ones behind it, which on a shared
   * dispatch queue would turn a single backed-off retry into a stall for
   * every other job.
   */
  public async pop(queue: string): Promise<string | undefined> {
    const entries = this.queueList[queue];
    if (!entries || entries.length === 0) return undefined;
    const now = this.dt.nowMillis();
    const index = entries.findIndex((entry) => entry.dueAt <= now);
    if (index === -1) return undefined;
    return entries.splice(index, 1)[0].message;
  }
}
