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
   *
   * Ignored when {@link headersFile} finds a `_headers` file: its rules decide.
   */
  cacheControl?: Partial<CacheControlOptions> | false;

  /**
   * Apply the `_headers` file at the root of the served files to every
   * response of this server, the way Cloudflare and Bay apply it to the
   * files they serve. `alepha build` writes that file into `dist/public`, so
   * one artifact sends the same headers on every host.
   *
   * When the file is present:
   *
   * - it is read once at boot, and a file that does not parse fails the boot,
   *   naming the line;
   * - after every other `server:onResponse` hook (helmet's included), the
   *   rules matching the request's percent-encoded path, relative to
   *   {@link path}, are applied on top of the response's headers: a file, the
   *   `index.html` alias, the history fallback, a 304;
   * - a response no rule caches gets `public, max-age=0, must-revalidate`,
   *   Cloudflare's default, and {@link cacheControl} is ignored.
   *
   * Whether or not it is present, `/_headers`, `/_redirects` and
   * `/.assetsignore` are never served. `_redirects` is applied by Cloudflare
   * only.
   *
   * The app's own public server turns this on (`ReactServerProvider`, from
   * disk or from a compiled binary); any other `$serve` leaves it off.
   *
   * @default false
   */
  headersFile?: boolean;

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
