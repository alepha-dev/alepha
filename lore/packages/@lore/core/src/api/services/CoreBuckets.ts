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
   * The bucket a host's command results land in.
   *
   * ⚠️ Named after the word Lore used before #E147, and staying so through #E166's move to core: the
   * bucket name is where every stored result file lives, and a migration
   * cannot move files. A new name would orphan every result already stored.
   */
  public static readonly RESULT_BUCKET = "estate-command-results";

  /**
   * Where a host job's whole log lands when it ends (#Q3984), as one JSON
   * document of both streams, gzipped since #Q4559 (a log stored before is
   * plain JSON, and still reads). Bay caps a job's output at 8 MiB.
   */
  public static readonly JOB_LOG_BUCKET = "host-job-logs";

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

  // The host buckets, core's since #E166: command results and job logs.
  public readonly pullResults = $storage({
    name: CoreBuckets.RESULT_BUCKET,
    description:
      "What a machine answered a logs or backup command with (list, verify, probe, restore)",
    maxSize: 1,
    mimeTypes: ["application/json"],
  });

  public readonly jobLogs = $storage({
    name: CoreBuckets.JOB_LOG_BUCKET,
    description: "The whole log of each host job, written when it ends",
    maxSize: 10,
    mimeTypes: ["application/gzip", "application/json"],
  });
}
