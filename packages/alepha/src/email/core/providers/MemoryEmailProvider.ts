import { $logger } from "alepha/logger";

import type {
  EmailAttachment,
  EmailProvider,
  EmailSendOptions,
  EmailSendResult,
} from "./EmailProvider.ts";

export interface EmailRecord {
  to: string;
  subject: string;
  body: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  messageId: string;
  sentAt: Date;
}

export class MemoryEmailProvider implements EmailProvider {
  protected readonly log = $logger();
  public records: EmailRecord[] = [];

  public async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const { to, subject, body, text, replyTo, headers, attachments } = options;
    this.log.debug("Sending email to memory store", { to, subject });

    // One id for the message, reused by every per-recipient record this call
    // fans out to, so a spec can match a delivery event back to the send that
    // caused it the same way a real transport's receipts do.
    const messageId = crypto.randomUUID();

    for (const recipient of Array.isArray(to) ? to : [to]) {
      this.records.push({
        to: recipient,
        subject,
        body,
        text,
        replyTo,
        headers,
        attachments,
        messageId,
        sentAt: new Date(),
      });
    }

    return { messageId };
  }

  /**
   * Get the last email sent (for testing purposes).
   */
  public get last(): EmailRecord | undefined {
    return this.records[this.records.length - 1];
  }
}
