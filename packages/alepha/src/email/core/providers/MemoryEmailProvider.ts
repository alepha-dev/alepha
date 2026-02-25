import { $logger } from "alepha/logger";
import type { EmailProvider, EmailSendOptions } from "./EmailProvider.ts";

export interface EmailRecord {
  to: string;
  subject: string;
  body: string;
  sentAt: Date;
}

export class MemoryEmailProvider implements EmailProvider {
  protected readonly log = $logger();
  public records: EmailRecord[] = [];

  public async send(options: EmailSendOptions): Promise<void> {
    const { to, subject, body } = options;
    this.log.debug("Sending email to memory store", { to, subject });

    for (const recipient of Array.isArray(to) ? to : [to]) {
      this.records.push({
        to: recipient,
        subject,
        body,
        sentAt: new Date(),
      });
    }
  }

  /**
   * Get the last email sent (for testing purposes).
   */
  public get last(): EmailRecord | undefined {
    return this.records[this.records.length - 1];
  }
}
