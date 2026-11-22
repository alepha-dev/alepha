import { $storage } from "alepha/api/files";

/**
 * The package's buckets (#E153), declared at boot like `WorkBuckets`.
 */
export class RequirementsBuckets {
  public static readonly EVIDENCE_BUCKET = "use-case-evidence";
  /**
   * One evidence file's cap, in megabytes, the bucket's and its upload
   * route's.
   */
  public static readonly EVIDENCE_MAX_SIZE_MB = 50;

  /**
   * Run evidence: screenshots and recordings. 50 MB a file: a quest's 10 MB
   * is too small for a video, and 50 stays under the 100 MB a Worker takes
   * in one request. Served as an attachment download, like every bucket.
   */
  public readonly evidence = $storage({
    name: RequirementsBuckets.EVIDENCE_BUCKET,
    description: "Use case run evidence",
    maxSize: RequirementsBuckets.EVIDENCE_MAX_SIZE_MB,
  });
}
