import type { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { ZType } from "../providers/ZodProvider.ts";
import { z } from "../providers/ZodProvider.ts";

export interface FileLike {
  /**
   * Filename.
   * @default "file"
   */
  name: string;

  /**
   * Mandatory MIME type of the file.
   * @default "application/octet-stream"
   */
  type: string;

  /**
   * Size of the file in bytes.
   *
   * Always 0 for streams, as the size is not known until the stream is fully read.
   *
   * @default 0
   */
  size: number;

  /**
   * Last modified timestamp in milliseconds since epoch.
   *
   * Always the current timestamp for streams, as the last modified time is not known.
   * We use this field to ensure compatibility with File API.
   *
   * @default Date.now()
   */
  lastModified: number;

  /**
   * Returns a ReadableStream or Node.js Readable stream of the file content.
   *
   * For streams, this is the original stream.
   */
  stream(): StreamLike;

  /**
   * Returns the file content as an ArrayBuffer.
   *
   * For streams, this reads the entire stream into memory.
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Returns the file content as a string.
   *
   * For streams, this reads the entire stream into memory and converts it to a string.
   */
  text(): Promise<string>;

  // -- node specific fields --

  /**
   * Optional file path, if the file is stored on disk.
   *
   * This is not from the File API, but rather a custom field to indicate where the file is stored.
   */
  filepath?: string;
}

/**
 * A schema describing a file field — i.e. one tagged `format: "binary"`.
 *
 * Documentation, not a constraint: zod has no distinct file schema, so this is
 * `ZType` and any schema satisfies it. {@link isTypeFile} is what actually
 * tells one apart, at runtime.
 */
export type FileSchema = ZType;

export const isTypeFile = (value: ZType): value is FileSchema => {
  // The format tag lives in zod's `.meta()`, read via `z.schema.format` — there
  // is no own `format` property to test for.
  return (
    !!value && typeof value === "object" && z.schema.format(value) === "binary"
  );
};

export const isFileLike = (value: any): value is FileLike => {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    typeof value.stream === "function"
  );
};

// ---------------------------------------------------------------------------------------------------------------------

// TODO: remove it, replace with WebStream
export type StreamLike =
  | ReadableStream
  | WebReadableStream
  | Readable
  | NodeJS.ReadableStream;

/**
 * A schema describing a streamed body. Same caveat as {@link FileSchema}: it
 * is `ZType`, so it documents intent rather than restricting anything.
 */
export type StreamSchema = ZType;
