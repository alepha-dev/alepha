import type { Static } from "alepha";
import { z } from "alepha";

export const bucketStatsSchema = z.object({
  bucket: z.string(),
  totalSize: z.number(),
  fileCount: z.number(),
});

export const mimeTypeStatsSchema = z.object({
  mimeType: z.string(),
  fileCount: z.number(),
});

export const storageStatsSchema = z.object({
  totalSize: z.number(),
  totalFiles: z.number(),
  byBucket: z.array(bucketStatsSchema),
  byMimeType: z.array(mimeTypeStatsSchema),
});

export type BucketStats = Static<typeof bucketStatsSchema>;
export type MimeTypeStats = Static<typeof mimeTypeStatsSchema>;
export type StorageStats = Static<typeof storageStatsSchema>;
