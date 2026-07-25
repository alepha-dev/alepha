import type { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { TSchema, TUnsafe } from "../providers/TypeProvider.ts";
import { z } from "../providers/TypeProvider.ts";

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
 * Schema view of FileLike.
 */
export type TFile = TUnsafe<FileLike>;

export const isTypeFile = (value: TSchema): value is TFile => {
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

export type TStream = TUnsafe<StreamLike>;
