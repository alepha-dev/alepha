import { $module } from "@alepha/core";
import { FileSystem } from "./FileSystem.ts";
import { NodeFileSystem } from "./NodeFileSystem.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./FileSystem.ts";
export * from "./helpers/createFile.ts";
export * from "./helpers/detectFileType.ts";
export * from "./helpers/getContentType.ts";
export * from "./NodeFileSystem.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides file system capabilities for Alepha applications with support for multiple file sources and operations.
 *
 * The file module enables working with files from various sources (URLs, buffers, streams) and provides
 * utilities for file type detection, content type determination, and common file system operations.
 *
 * @see {@link FileSystem}
 * @see {@link NodeFileSystem}
 * @module alepha.file
 */
export const AlephaFile = $module({
  name: "alepha.file",
  descriptors: [],
  services: [FileSystem, NodeFileSystem],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: FileSystem,
      use: NodeFileSystem,
    }),
});
