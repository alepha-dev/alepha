import { basename, isAbsolute, join } from "node:path";
import type { Readable as NodeStream } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { type ServerHandler, ServerRouterProvider } from "alepha/server";
import { FileDetector } from "alepha/system";

import type { StaticFileSource } from "../interfaces/StaticFileSource.ts";
import { $serve, type ServePrimitiveOptions } from "../primitives/$serve.ts";
import { DiskStaticFileSource } from "../services/DiskStaticFileSource.ts";

export class ServerStaticProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly routerProvider = $inject(ServerRouterProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly log = $logger();
  protected readonly directories: ServeDirectory[] = [];

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      await Promise.all(
        this.alepha
          .primitives($serve)
          .map((it) => this.createStaticServer(it.options)),
      );
    },
  });

  /**
   * Mount every file of `source` under `options.path`.
   *
   * Without a source the files come from `options.root` on disk, which is
   * what every `$serve` does. A compiled binary passes the source that reads
   * the files embedded in it; the handler below does not know the difference.
   */
  public async createStaticServer(
    options: ServePrimitiveOptions,
    source?: StaticFileSource,
  ): Promise<void> {
    const prefix = options.path ?? "/";
    const fileSource = source ?? this.createDiskSource(options);

    this.log.debug("Serve static files", {
      prefix,
      root: source ? "(source)" : options.root,
    });

    // 1. every file of the source, precompressed siblings included
    const files = await fileSource.list();

    // 2. create a $route for each file (yes, this could be a lot of routes)
    const routes = await Promise.all(
      files.map(async (urlPath) => {
        const routePath = `${prefix}${encodeURI(urlPath)}`.replace(/\/+/g, "/");
        this.log.trace(`Mount ${routePath} -> ${urlPath}`);
        return {
          silent: options.silent,
          path: routePath,
          handler: await this.createFileHandler(fileSource, urlPath, options),
        };
      }),
    );

    for (const route of routes) {
      this.routerProvider.createRoute(route);

      // if route is for index.html, also create a route without it
      // e.g. /my/path/index.html -> /my/path/
      if (
        options.indexFallback !== false &&
        route.path.endsWith("index.html")
      ) {
        this.routerProvider.createRoute({
          silent: options.silent,
          path: route.path.replace(/index\.html$/, ""),
          handler: route.handler,
        });
      }
    }

    // 3. store the directory info for reference
    this.directories.push({ options, files });

    // bonus! for SPAs, handle history API fallback
    if (options.historyApiFallback) {
      // meaning all unmatched routes should serve index.html
      this.routerProvider.createRoute({
        silent: options.silent,
        path: join(prefix, "*").replace(/\\/g, "/"),
        handler: async (request) => {
          const { reply } = request;

          if (request.url.pathname.includes(".")) {
            // If the request is for a file (e.g., /style.css), do not fall back
            reply.headers["content-type"] = "text/plain";
            reply.body = "Not Found";
            reply.status = 404;
            return;
          }

          const stream = await fileSource.open("/index.html");
          if (!stream) {
            reply.headers["content-type"] = "text/plain";
            reply.body = "Not Found";
            reply.status = 404;
            return;
          }

          reply.headers["content-type"] = "text/html";
          reply.status = 200;
          return stream;
        },
      });
    }
  }

  /**
   * The request handler for one file of `source`, written once for every
   * kind of source: its metadata is read here, at boot, and the bytes on
   * each request.
   */
  public async createFileHandler(
    source: StaticFileSource,
    filepath: string,
    options: ServePrimitiveOptions,
  ): Promise<ServerHandler> {
    const filename = basename(filepath);

    const hasGzip = await source.has(`${filepath}.gz`);
    const hasBr = await source.has(`${filepath}.br`);

    const fileStat = await source.stat(filepath);
    const lastModified = fileStat.mtime.toUTCString();
    const etag = `"${fileStat.size}-${fileStat.mtime.getTime()}"`;
    const contentType = this.fileDetector.getContentType(filename);
    const cacheControl = this.getCacheControl(filename, options);

    return async (request): Promise<NodeStream | NodeWebStream | undefined> => {
      const { headers, reply } = request;
      let path = filepath;

      // 01/26 - when calling "/directory", redirect to "/directory/"
      if (
        options.path &&
        options.path === request.url.pathname &&
        !options.path.endsWith("/")
      ) {
        reply.redirect(`${options.path}/`, 301);
        return;
      }

      // The response body depends on Accept-Encoding when a precompressed
      // sibling exists, so it MUST vary on it — without this a shared cache
      // can hand a brotli body to a client that never asked for brotli.
      let chosenEncoding = "";
      const encoding = headers["accept-encoding"];
      if (hasBr || hasGzip) {
        // Append: the CORS hook may already have added `Origin`.
        reply.headers.vary = reply.headers.vary
          ? `${reply.headers.vary}, accept-encoding`
          : "accept-encoding";
      }
      if (encoding) {
        if (hasBr && encoding.includes("br")) {
          reply.headers["content-encoding"] = "br";
          chosenEncoding = "br";
          path += ".br";
        } else if (hasGzip && encoding.includes("gzip")) {
          reply.headers["content-encoding"] = "gzip";
          chosenEncoding = "gzip";
          path += ".gz";
        }
      }

      reply.headers["content-type"] = contentType;
      reply.headers["accept-ranges"] = "bytes";
      reply.headers["last-modified"] = lastModified;

      if (cacheControl) {
        reply.headers["cache-control"] =
          `public, max-age=${cacheControl.maxAge}`;
        if (cacheControl.immutable) {
          reply.headers["cache-control"] += ", immutable";
        }
      }

      // Distinct per encoding: identity, gzip and brotli are different
      // bytes, and one shared ETag made 304 revalidation unable to tell them
      // apart.
      const variantEtag = chosenEncoding
        ? `${etag.slice(0, -1)}-${chosenEncoding}"`
        : etag;

      reply.headers.etag = variantEtag;
      // `If-None-Match` takes precedence (RFC 9110 12.2.2): a date match
      // alone must not short-circuit when the etag names another encoding
      // variant.
      const notModified = headers["if-none-match"]
        ? headers["if-none-match"] === variantEtag
        : headers["if-modified-since"] === lastModified;
      if (notModified) {
        reply.status = 304;
        return;
      }

      const body = await source.open(path);
      if (!body) {
        // Listed at boot, gone since.
        reply.status = 404;
        return;
      }
      return body;
    };
  }

  /**
   * The disk source every `$serve` uses, rooted at `options.root` (relative
   * to the working directory when not absolute).
   */
  protected createDiskSource(
    options: ServePrimitiveOptions,
  ): DiskStaticFileSource {
    let root = options.root ?? process.cwd();
    if (!isAbsolute(root)) {
      root = join(process.cwd(), root);
    }
    return new DiskStaticFileSource(root, options.ignoreDotEnvFiles);
  }

  protected getCacheFileTypes(): string[] {
    return [
      ".js",
      ".css",
      ".woff",
      ".woff2",
      ".ttf",
      ".eot",
      ".otf",
      ".jpg",
      ".jpeg",
      ".png",
      ".svg",
      ".gif",
    ];
  }

  protected getCacheControl(
    filename: string,
    options: ServePrimitiveOptions,
  ): { maxAge: number; immutable: boolean } | undefined {
    if (!options.cacheControl) {
      return;
    }

    const fileTypes =
      options.cacheControl.fileTypes ?? this.getCacheFileTypes();

    for (const type of fileTypes) {
      if (filename.endsWith(type)) {
        return {
          immutable: options.cacheControl.immutable ?? true,
          maxAge: this.toDeltaSeconds(options.cacheControl.maxAge),
        };
      }
    }
  }

  /**
   * Turn the configured `maxAge` into the integer `delta-seconds` the header
   * grammar allows, and say something when it was written in the unit nobody
   * means.
   *
   * RFC 9111 defines `delta-seconds` as a non-negative integer, so a
   * fractional value is not a shorter cache window: it is a malformed
   * directive a cache may discard outright, taking `immutable` down with it.
   * Hence the rounding.
   *
   * Hence also the warning, and note what it keys on. The tell is not the
   * magnitude - 3.6 seconds is a perfectly ordinary-looking number and no
   * threshold catches it without rejecting durations somebody might really
   * want. The tell is the **bare number**: `maxAge` is a `DurationLike`, where
   * a plain number is milliseconds, and no one has ever wanted a cache lifetime
   * measured in them. That is how `maxAge: 3600`, written meaning an hour, put
   * `max-age=3.6` on every asset of every Alepha app. Anyone who genuinely
   * wants milliseconds can say `[n, "milliseconds"]` and be believed.
   *
   * The value is rounded, never reinterpreted: guessing the intended unit would
   * hide the mistake rather than surface it.
   */
  protected toDeltaSeconds(maxAge: DurationLike | undefined): number {
    if (typeof maxAge === "number") {
      this.log.warn(
        `Static cache-control maxAge is the bare number ${maxAge}, which a DurationLike reads as MILLISECONDS (${maxAge / 1000}s). Pass [n, "seconds"] or [n, "hours"] to mean what it looks like.`,
      );
    }

    return Math.round(
      this.dateTimeProvider.duration(maxAge ?? [30, "days"]).as("seconds"),
    );
  }
}

export interface ServeDirectory {
  options: ServePrimitiveOptions;
  files: string[];
}
