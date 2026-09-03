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
  contact: z.text(),
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
