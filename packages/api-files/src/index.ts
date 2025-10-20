import { AlephaBucket } from "@alepha/bucket";
import { $module } from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import type { UserAccountToken } from "@alepha/security";
import { AlephaServerCache } from "@alepha/server-cache";
import { AlephaServerMultipart } from "@alepha/server-multipart";
import { FileController } from "./controllers/FileController.ts";
import { FileJobs } from "./jobs/FileJobs.ts";
import { FileService } from "./services/FileService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/FileController.ts";
export * from "./entities/files.ts";
export * from "./services/FileService.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/bucket" {
  interface BucketFileOptions {
    /**
     * Time to live for the files in the bucket.
     */
    ttl?: DurationLike;

    /**
     * Tags for the bucket.
     */
    tags?: string[];

    /**
     * User performing the operation.
     */
    user?: UserAccountToken;

    /**
     * Whether to persist the file metadata in the database.
     *
     * @default true
     */
    persist?: boolean;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides file management API endpoints for Alepha applications.
 *
 * This module includes file upload, download, storage management,
 * and file metadata operations.
 *
 * @module alepha.api.files
 */
export const AlephaApiFiles = $module({
  name: "alepha.api.files",
  services: [FileController, FileJobs, FileService],
  register: (alepha) => {
    alepha
      .with(AlephaBucket)
      .with(AlephaServerCache)
      .with(AlephaServerMultipart)
      .with(FileController)
      .with(FileJobs);
  },
});
