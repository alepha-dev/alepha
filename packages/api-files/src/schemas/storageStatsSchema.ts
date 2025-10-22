import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const bucketStatsSchema = t.object({
  bucket: t.string(),
  totalSize: t.number(),
  fileCount: t.number(),
});

export const mimeTypeStatsSchema = t.object({
  mimeType: t.string(),
  fileCount: t.number(),
});

export const storageStatsSchema = t.object({
  totalSize: t.number(),
  totalFiles: t.number(),
  byBucket: t.array(bucketStatsSchema),
  byMimeType: t.array(mimeTypeStatsSchema),
});

export type BucketStats = Static<typeof bucketStatsSchema>;
export type MimeTypeStats = Static<typeof mimeTypeStatsSchema>;
export type StorageStats = Static<typeof storageStatsSchema>;
