import { $module } from "alepha";
import { FileSystemProvider } from "./providers/FileSystemProvider.ts";
import { MemoryFileSystemProvider } from "./providers/MemoryFileSystemProvider.ts";
import { NodeFileSystemProvider } from "./providers/NodeFileSystemProvider.ts";
import { FileDetector } from "./services/FileDetector.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileError.ts";
export * from "./providers/FileSystemProvider.ts";
export * from "./providers/MemoryFileSystemProvider.ts";
export * from "./providers/NodeFileSystemProvider.ts";
export * from "./services/FileDetector.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | tooling | standard | stable |
 *
 * File operations and type detection.
 *
 * **Features:**
 * - File type detection
 * - MIME type utilities
 * - Path operations
 *
 * @module alepha.file
 */
export const AlephaFile = $module({
  name: "alepha.file",
  primitives: [],
  services: [
    FileDetector,
    FileSystemProvider,
    MemoryFileSystemProvider,
    NodeFileSystemProvider,
  ],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: FileSystemProvider,
      use: NodeFileSystemProvider,
    }),
});
