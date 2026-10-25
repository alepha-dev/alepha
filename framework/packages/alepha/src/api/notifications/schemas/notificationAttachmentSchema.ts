import { type Infer, z } from "alepha";

/**
 * A file to attach, named as a **reference** rather than carried as bytes.
 *
 * ⚠️ **Never inline the content.** This rides in `job_executions.payload`, a
 * JSON column that is logged, retried, and kept for the retention window on
 * a `record: "all"` job. A 5 MB PDF base64'd in there is a row nobody can
 * read and a queue message over Cloudflare's 128 KB limit. The bytes are
 * fetched at send time and only then.
 *
 * `fileId` and not a raw object key: `$storage` is addressed by the `files`
 * row it wrote, which is what carries the filename, the MIME type and the
 * tenant. (The original quest said `key`; that would be the `alepha/bucket`
 * layer, which has no metadata and no tenant scoping.)
 */
export const notificationAttachmentSchema = z.object({
  /**
   * The `$storage` name the file lives in.
   */
  storage: z.text({ maxLength: 100 }),
  /**
   * The `files` row id, as returned by `$storage.upload()`.
   */
  fileId: z.uuid(),
  /**
   * Override the name the recipient sees. Defaults to the stored filename.
   */
  filename: z.text({ maxLength: 255 }).optional(),
  /**
   * Override the MIME type. Defaults to the stored one.
   */
  contentType: z.text({ maxLength: 100 }).optional(),
  /**
   * Content-ID, for referencing the file inline from the body as
   * `<img src="cid:...">` rather than as a downloadable attachment.
   */
  cid: z.text({ maxLength: 100 }).optional(),
});

export type NotificationAttachment = Infer<typeof notificationAttachmentSchema>;
