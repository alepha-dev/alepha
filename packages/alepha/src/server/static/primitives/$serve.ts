import { createPrimitive, KIND, Primitive } from "alepha";
import type { DurationLike } from "alepha/datetime";

/**
 * Create a new static file handler.
 */
export const $serve = (options: ServePrimitiveOptions = {}): ServePrimitive => {
  return createPrimitive(ServePrimitive, options);
};

export interface ServePrimitiveOptions {
  /**
   * Prefix for the served path.
   *
   * @default "/"
   */
  path?: string;

  /**
   * Path to the directory to serve.
   *
   * @default process.cwd()
   */
  root?: string;

  /**
   * If true, primitive will be ignored.
   *
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether to exclude dot files (e.g. `.gitignore`, `.env`) from the served
   * directory. When true (the default), dot files are skipped.
   *
   * @default true
   */
  ignoreDotEnvFiles?: boolean;

  /**
   * Whether to use the index.html file when the path is a directory.
   *
   * @default true
   */
  indexFallback?: boolean;

  /**
   * Force all requests "not found" to be served with the index.html file.
   * This is useful for single-page applications (SPAs) that use client-side only routing.
   */
  historyApiFallback?: boolean;

  /**
   * Optional name of the primitive.
   * This is used for logging and debugging purposes.
   *
   * @default Key name.
   */
  name?: string;

  /**
   * Cache-control configuration. When omitted (or `false`), no cache-control
   * headers are set; pass `{}` to enable with the defaults below.
   */
  cacheControl?: Partial<CacheControlOptions> | false;

  /**
   * Whether to suppress logging for this primitive.
   *
   * @default false
   */
  silent?: boolean;
}

export interface CacheControlOptions {
  /**
   * File extensions that receive cache-control headers.
   *
   * @default [".js", ".css", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".jpg", ".jpeg", ".png", ".svg", ".gif"]
   */
  fileTypes: string[];

  /**
   * The maximum age of the cache.
   *
   * @default [30, "days"]
   */
  maxAge: DurationLike;

  /**
   * Whether to use immutable cache control headers.
   *
   * @default true
   */
  immutable: boolean;
}

export class ServePrimitive extends Primitive<ServePrimitiveOptions> {}

$serve[KIND] = ServePrimitive;
