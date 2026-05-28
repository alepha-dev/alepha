import { $module } from "alepha";
import { AlephaBucket } from "alepha/bucket";
import type { DurationLike } from "alepha/datetime";
import type { UserAccountToken } from "alepha/security";
import { AlephaServerEtag } from "alepha/server/etag";
import { AdminFileStatsController } from "./controllers/AdminFileStatsController.ts";
import { FileController } from "./controllers/FileController.ts";
import { FileJobs } from "./jobs/FileJobs.ts";
import { FileAccessProvider } from "./providers/FileAccessProvider.ts";
import { FileService } from "./services/FileService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminFileStatsController.ts";
export * from "./controllers/FileController.ts";
export * from "./entities/files.ts";
export * from "./jobs/FileJobs.ts";
export * from "./providers/FileAccessProvider.ts";
export * from "./schemas/fileCreatorSummarySchema.ts";
export * from "./schemas/fileQuerySchema.ts";
export * from "./schemas/fileResourceSchema.ts";
export * from "./schemas/storageStatsSchema.ts";
export * from "./services/FileService.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/bucket" {
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
 * File management endpoints.
 *
 * **Features:**
 * - Upload/download endpoints
 * - File metadata storage
 * - TTL-based expiration
 * - Storage statistics
 *
 * @module alepha.api.files
 */
export const AlephaApiFiles = $module({
  name: "alepha.api.files",
  services: [
    FileController,
    AdminFileStatsController,
    FileJobs,
    FileService,
    FileAccessProvider,
  ],
  imports: [AlephaBucket, AlephaServerEtag],
});
