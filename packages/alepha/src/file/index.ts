import { $module } from "alepha";
import { FileSystemProvider } from "./providers/FileSystemProvider.ts";
import { NodeFileSystemProvider } from "./providers/NodeFileSystemProvider.ts";
import { FileDetector } from "./services/FileDetector.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/FileSystemProvider.ts";
export * from "./providers/NodeFileSystemProvider.ts";
export * from "./services/FileDetector.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides file system capabilities for Alepha applications with support for multiple file sources and operations.
 *
 * The file module enables working with files from various sources (URLs, buffers, streams) and provides
 * utilities for file type detection, content type determination, and common file system operations.
 *
 * @see {@link FileDetector}
 * @see {@link FileSystemProvider}
 * @see {@link NodeFileSystemProvider}
 * @module alepha.file
 */
export const AlephaFile = $module({
  name: "alepha.file",
  descriptors: [],
  services: [FileDetector, FileSystemProvider, NodeFileSystemProvider],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: FileSystemProvider,
      use: NodeFileSystemProvider,
    }),
});
