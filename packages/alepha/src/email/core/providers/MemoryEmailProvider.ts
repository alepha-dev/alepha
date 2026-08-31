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

  /**
   * Whether an email was sent to this address.
   *
   * @example
   * ```typescript
   * expect(email.wasSent("user@example.com")).toBe(true);
   * expect(email.wasSent("user@example.com", /verify/i)).toBe(true);
   * ```
   *
   * `subject` matches the subject line. For the body, use
   * {@link wasSentMatching}: a subject is a short deliberate string and a
   * body is markup, so one loose match over both would go green on the
   * wrong thing.
   *
   * ⚠️ One record per RECIPIENT. A single send to three addresses answers
   * `true` for each of them, which is what a spec asking "did this person
   * get the mail" means.
   */
  public wasSent(to: string, subject?: RegExp | string): boolean {
    return this.records.some(
      (record) =>
        record.to === to &&
        (subject === undefined ||
          (typeof subject === "string"
            ? record.subject.includes(subject)
            : subject.test(record.subject))),
    );
  }

  /**
   * Whether an email to this address had a BODY matching `pattern`.
   *
   * @example
   * ```typescript
   * expect(email.wasSentMatching("user@example.com", /\/verify\?code=/)).toBe(
   *   true,
   * );
   * ```
   *
   * Checks the html body and the text alternative, because an app may send
   * either and a test should not have to know which.
   */
  public wasSentMatching(to: string, pattern: RegExp): boolean {
    return this.records.some(
      (record) =>
        record.to === to &&
        (pattern.test(record.body ?? "") || pattern.test(record.text ?? "")),
    );
  }
}
