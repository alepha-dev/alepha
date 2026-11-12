import { $storage } from "alepha/api/files";

import { ArtifactService } from "./ArtifactService.ts";

/**
 * The deploy package's buckets, as a boot class listed in its module (#Q3404).
 *
 * A `$storage` is a boot primitive: an upload names its bucket, and the
 * bucket is looked up by name among every declared one, so it has to exist
 * before the first request. Declared on a controller, it made the
 * controller a boot class; declared here, the controllers stay pure and
 * reach their bucket through this class.
 */
export class DeployBuckets {
  /**
   * The bucket an estate's command results land in.
   */
  public static readonly RESULT_BUCKET = "estate-command-results";

  /**
   * Where the tarballs live.
   *
   * ## ⚠️ The ceiling, and what it is really bounding
   *
   * 20 MB. A packed Alepha app is a few megabytes gzipped - Cloudflare's own
   * Worker script limit is 10 MB compressed - so this is generous for the
   * thing it is for and deliberately not open-ended.
   *
   * It is not only a storage quota. `z.file()` materialises the part before
   * `$secure` runs, so this number is also how much an UNAUTHENTICATED request
   * can make a Worker isolate hold. That isolate has around 128 MB in total,
   * which is the reason this is 20 and not 200.
   *
   * The MIME list is the zstd and gzip families plus the catch-all every
   * `curl -F` sends. It is a usability guard rather than a security control -
   * the type is client-supplied - and the real check on the content is that
   * the bytes have to decompress into a tar carrying a readable
   * `manifest.json`.
   *
   * ⚠️ **gzip stays listed.** `alepha pack` produces zstd now, but artifacts
   * pushed before the move are still in the registry and a re-push of one must
   * not be refused on its type.
   */
  public readonly artifacts = $storage({
    name: ArtifactService.BUCKET,
    description: "Build artifacts pushed by CI",
    maxSize: 20,
    mimeTypes: [
      "application/zstd",
      "application/x-zstd",
      "application/gzip",
      "application/x-gzip",
      "application/x-compressed-tar",
      "application/octet-stream",
    ],
  });

  public readonly pullResults = $storage({
    name: DeployBuckets.RESULT_BUCKET,
    description:
      "What a machine answered a logs or backup command with (list, verify, probe, restore)",
    maxSize: 1,
    mimeTypes: ["application/json"],
  });
}
