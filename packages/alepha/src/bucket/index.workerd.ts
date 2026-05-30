import { $module } from "alepha";
import { $bucket } from "./primitives/$bucket.ts";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";
import { R2FileStorageProvider } from "./providers/R2FileStorageProvider.ts";
import { S3FileStorageProvider } from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileNotFoundError.ts";
export * from "./primitives/$bucket.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";
export * from "./providers/R2FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaBucket = $module({
  name: "alepha.bucket",
  primitives: [$bucket],
  services: [
    FileStorageProvider,
    MemoryFileStorageProvider,
    R2FileStorageProvider,
  ],
  variants: [
    MemoryFileStorageProvider,
    R2FileStorageProvider,
    S3FileStorageProvider, // S3 is allowed, it's ok inside workers (s3mini = fetch)
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: FileStorageProvider,
      use: alepha.isTest() ? MemoryFileStorageProvider : R2FileStorageProvider,
    });
  },
});
