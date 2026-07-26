import { $logger } from "alepha/logger";
import { QueueProvider } from "./QueueProvider.ts";

// `extends`, not `implements` — otherwise this misses default members added
// to the base class (it silently lost `pushMany` that way).
export class MemoryQueueProvider extends QueueProvider {
  protected readonly log = $logger();
  protected queueList: Record<string, string[]> = {};

  public async push(queue: string, ...messages: string[]): Promise<void> {
    if (this.queueList[queue] == null) {
      this.queueList[queue] = [];
    }

    this.queueList[queue].push(...messages);
  }

  public override async pushMany(
    queue: string,
    messages: string[],
  ): Promise<void> {
    await this.push(queue, ...messages);
  }

  public async pop(queue: string): Promise<string | undefined> {
    return this.queueList[queue]?.shift();
  }
}
