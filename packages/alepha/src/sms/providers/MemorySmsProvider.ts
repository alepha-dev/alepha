import { $logger } from "alepha/logger";
import type { SmsProvider, SmsSendOptions } from "./SmsProvider.ts";

export interface SmsRecord {
  to: string;
  message: string;
  sentAt: Date;
}

export class MemorySmsProvider implements SmsProvider {
  protected readonly log = $logger();
  public records: SmsRecord[] = [];

  public async send(options: SmsSendOptions): Promise<void> {
    const { to, message } = options;
    this.log.debug("Sending SMS to memory store", { to, message });

    for (const recipient of Array.isArray(to) ? to : [to]) {
      this.records.push({
        to: recipient,
        message,
        sentAt: new Date(),
      });
    }
  }

  /**
   * Get the last SMS sent (for testing purposes).
   */
  public get last(): SmsRecord | undefined {
    return this.records[this.records.length - 1];
  }
}
