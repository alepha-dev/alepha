import { $module } from "@alepha/core";
import { FileSystemProvider } from "./providers/FileSystemProvider.ts";
import { NodeFileSystemProvider } from "./providers/NodeFileSystemProvider.ts";
import { FileDetector } from "./services/FileDetector.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/FileSystemProvider.ts";
export * from "./providers/NodeFileSystemProvider.ts";
export * from "./services/FileDetector.ts";

// Re-export commonly used utilities for backward compatibility
export { FileDetector as FileDetectorService } from "./services/FileDetector.ts";

/**
 * Gets the content type (MIME type) based on a filename.
 * This is a convenience function that uses FileDetector.mimeMap.
 *
 * @param filename - The filename to check
 * @returns The MIME type
 *
 * @example
 * ```typescript
 * import { getContentType } from "@alepha/file";
 * const mimeType = getContentType("image.png"); // "image/png"
 * ```
 */
export function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() || "";
  return FileDetector.mimeMap[ext] || "application/octet-stream";
}

/**
 * Converts a Node.js Buffer to an ArrayBuffer.
 *
 * @param buffer - The Buffer to convert
 * @returns The ArrayBuffer
 *
 * @example
 * ```typescript
 * import { bufferToArrayBuffer } from "@alepha/file";
 * const buffer = Buffer.from("hello");
 * const arrayBuffer = bufferToArrayBuffer(buffer);
 * ```
 */
export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

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
