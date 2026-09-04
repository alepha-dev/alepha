import { type Infer, z } from "alepha";

import { notificationAttachmentSchema } from "./notificationAttachmentSchema.ts";

export const notificationPayloadSchema = z.object({
  /**
   * The delivery channel this row is for, one per channel the template
   * declares. Open: the legal values are whatever `NotificationChannel`
   * services the container registers.
   */
  type: z.text({ maxLength: 32 }),
  template: z.text(),
  /**
   * Who this message is for, on an addressable channel.
   *
   * Optional because a sink channel has no recipient: it fires at a
   * destination named in the template, and the destination never travels in
   * the payload (a webhook is a secret, and an outbox row is not where a
   * secret belongs). `$notification.push()` still requires a contact at the
   * type level unless every channel the template declares is a sink.
   *
   * Making a required field optional is backward compatible for rows already
   * queued: this schema validates the job payload, and every existing row
   * carries one.
   */
  contact: z.text().optional(),
  variables: z.record(z.text(), z.any()).optional(),
  category: z.text().optional(),
  critical: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  /**
   * Recipient language (e.g. "fr" or "fr-FR") used to pick `translations`.
   */
  lang: z.text().optional(),
  /**
   * Owning tenant for this notification.
   *
   * It is also stamped on the `job_executions` row, which is what keeps the
   * admin list org-scoped. This copy exists because the sender runs inside a
   * job and a job handler never sees its own row: without it, nothing that
   * runs at send time (the suppression gate, the preference seam) can know
   * which tenant a message belongs to.
   *
   * Additive: rows pushed before this field existed simply lack it.
   */
  organizationId: z.uuid().optional(),
  /**
   * Files to attach, as references. Resolved to bytes at send time; see
   * {@link notificationAttachmentSchema} for why they are never inlined here.
   */
  attachments: z.array(notificationAttachmentSchema).optional(),
});

export type NotificationPayload = Infer<typeof notificationPayloadSchema>;
