import { $module } from "alepha";
import { $bucket } from "./primitives/$bucket.ts";
import { CloudflareR2Provider } from "./providers/CloudflareR2Provider.ts";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileNotFoundError.ts";
export * from "./primitives/$bucket.ts";
export * from "./providers/CloudflareR2Provider.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaBucket = $module({
  name: "alepha.bucket",
  primitives: [$bucket],
  services: [
    FileStorageProvider,
    MemoryFileStorageProvider,
    CloudflareR2Provider,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: FileStorageProvider,
      use: alepha.isTest() ? MemoryFileStorageProvider : CloudflareR2Provider,
    });
  },
});
