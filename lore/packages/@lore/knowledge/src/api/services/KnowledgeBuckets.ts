import { $storage } from "alepha/api/files";

import { FolioAttachmentService } from "./FolioAttachmentService.ts";

/**
 * The knowledge package's buckets, as a boot class listed in its module (#Q3404).
 *
 * A `$storage` is a boot primitive: an upload names its bucket, and the
 * bucket is looked up by name among every declared one, so it has to exist
 * before the first request. Declared on a controller, it made the
 * controller a boot class; declared here, the controllers stay pure and
 * reach their bucket through this class.
 */
export class KnowledgeBuckets {
  /**
   * Storage for Folio attachments. Declared here so `?bucket=archive-blobs`
   * resolves — without it every Folio upload 404s with
   * "Storage 'archive-blobs' not found." (Bucket value kept as
   * `archive-blobs`, not renamed — see the note on
   * `FolioAttachmentService.BUCKET`.) Any logged-in user with `file:create`
   * can upload; per-project membership is enforced downstream by the
   * `registerAttachment` action below.
   */
  public readonly folioAttachments = $storage({
    name: FolioAttachmentService.BUCKET,
    description: "Folio attachments",
    // The folio editor uploads here straight from the browser.
    clientUploads: true,
  });
}
