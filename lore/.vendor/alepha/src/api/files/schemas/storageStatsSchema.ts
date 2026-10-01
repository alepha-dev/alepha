import type { Infer } from "alepha";
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
  /**
   * The total quota in bytes (`filesOptions.maxTotalSize`), every storage
   * together. `0` when there is none.
   */
  quota: z.number(),
});

export type BucketStats = Infer<typeof bucketStatsSchema>;
export type MimeTypeStats = Infer<typeof mimeTypeStatsSchema>;
export type StorageStats = Infer<typeof storageStatsSchema>;
