import { $inject, Alepha, AlephaError } from "alepha";
import { $storage } from "alepha/api/files";
import type { EmailAttachment } from "alepha/email";
import { $logger } from "alepha/logger";

import type { NotificationAttachment } from "../schemas/notificationAttachmentSchema.ts";
import { NotificationSettings } from "./NotificationSettings.ts";

/**
 * Turns attachment references into bytes, at send time and not before.
 *
 * The payload names a `$storage` and a file id; this is where that becomes
 * something a provider can put on the wire. Doing it here rather than at
 * push time is what keeps `job_executions.payload` readable and keeps a
 * queue message under Cloudflare's 128 KB limit.
 */
export class NotificationAttachmentService {
  protected readonly alepha = $inject(Alepha);
  protected readonly settings = $inject(NotificationSettings);
  protected readonly log = $logger();

  /**
   * Read every attachment, or fail the send with an error naming what went
   * wrong.
   *
   * ⚠️ A missing object is a **send failure**, never a silent send without
   * the attachment. An invoice email with no invoice is worse than one that
   * did not arrive: the recipient has no way to know something is missing.
   */
  public async resolve(
    attachments: NotificationAttachment[] | undefined,
    context: { organizationId?: string },
  ): Promise<EmailAttachment[] | undefined> {
    if (!attachments?.length) {
      return undefined;
    }

    const { maxAttachmentCount, maxAttachmentBytes } = this.settings.current;
    if (attachments.length > maxAttachmentCount) {
      throw new AlephaError(
        `Notification has ${attachments.length} attachments, over the limit of ${maxAttachmentCount}. Raise 'maxAttachmentCount' on the api.notifications parameter, or send fewer.`,
      );
    }

    const resolved: EmailAttachment[] = [];
    let total = 0;

    for (const attachment of attachments) {
      const file = await this.read(attachment, context);
      total += file.content.length;

      if (total > maxAttachmentBytes) {
        throw new AlephaError(
          `Notification attachments exceed ${maxAttachmentBytes} bytes in total. Raise 'maxAttachmentBytes' on the api.notifications parameter, or send fewer.`,
        );
      }

      resolved.push(file);
    }

    return resolved;
  }

  protected async read(
    attachment: NotificationAttachment,
    context: { organizationId?: string },
  ): Promise<EmailAttachment> {
    const storage = this.alepha
      .primitives($storage)
      .find((it) => it.name === attachment.storage);

    if (!storage) {
      throw new AlephaError(
        `Notification attachment names storage '${attachment.storage}', which this app does not declare.`,
      );
    }

    let entity: { organizationId?: string | null };
    let file: {
      name: string;
      type: string;
      arrayBuffer(): Promise<ArrayBuffer>;
    };

    try {
      entity = await storage.get(attachment.fileId);
      file = await storage.download(attachment.fileId);
    } catch (error) {
      // Every failure here is rewritten to name the attachment. The ORM's
      // own message is "Entity from 'files' was not found", which tells an
      // operator staring at a failed receipt nothing at all about which
      // file, in which storage, of which notification.
      //
      // A retry re-reads the object, so if it was deleted between attempt
      // one and attempt three the retry fails differently from the original.
      // That is fine, and the receipt carries this message rather than
      // looking like a provider outage.
      throw new AlephaError(
        `Notification attachment ${attachment.fileId} could not be read from storage '${attachment.storage}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // The sender runs tenant-less, so nothing scopes that read for us. A
    // payload naming another tenant's file id would otherwise mail one org's
    // document to another org's contact. Outside the try: this is a refusal,
    // not a storage failure, and must not be rewritten as one.
    if (
      context.organizationId &&
      entity.organizationId &&
      entity.organizationId !== context.organizationId
    ) {
      throw new AlephaError(
        `Notification attachment ${attachment.fileId} belongs to another tenant.`,
      );
    }

    const buffer = await file.arrayBuffer();

    return {
      filename: attachment.filename ?? file.name,
      content: new Uint8Array(buffer),
      contentType: attachment.contentType ?? file.type,
      cid: attachment.cid,
    };
  }
}
