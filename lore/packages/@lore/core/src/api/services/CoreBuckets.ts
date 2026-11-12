import { $storage } from "alepha/api/files";

/**
 * The core package's buckets, as a boot class listed in its module (#Q3404).
 *
 * A `$storage` is a boot primitive: an upload names its bucket, and the
 * bucket is looked up by name among every declared one, so it has to exist
 * before the first request. Declared on a controller, it made the
 * controller a boot class; declared here, the controllers stay pure and
 * reach their bucket through this class.
 */
export class CoreBuckets {
  /**
   * Project icons (avatars). Image-only, 2 MB cap.
   *
   * Bucket value kept as `campaign-icons`, not renamed to `project-icons`:
   * it's a value already persisted on every existing `files` row (and in
   * production), not just an in-code identifier — same reasoning that keeps
   * `FOLIO_ATTACHMENT_BUCKET` at `"archive-blobs"` (see the note in
   * `FolioAttachmentService.ts`) and `FeedbackRateLimiter.ATTACHMENT_BUCKET` at
   * `"petition-attachments"`.
   */
  public readonly projectIcons = $storage({
    name: "campaign-icons",
    description: "Project icons",
    // The project settings form uploads here straight from the browser.
    clientUploads: true,
    // Megabytes. This read `2 * 1024 * 1024` — two million megabytes.
    maxSize: 2,
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });
}
