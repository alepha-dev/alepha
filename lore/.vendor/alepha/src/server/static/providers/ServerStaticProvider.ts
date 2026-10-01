import { basename, isAbsolute, join } from "node:path";
import type { Readable as NodeStream } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { type ServerHandler, ServerRouterProvider } from "alepha/server";
import { FileDetector } from "alepha/system";

import type { HeadersRule } from "../interfaces/HeadersFile.ts";
import type { StaticFileSource } from "../interfaces/StaticFileSource.ts";
import { $serve, type ServePrimitiveOptions } from "../primitives/$serve.ts";
import { DiskStaticFileSource } from "../services/DiskStaticFileSource.ts";
import { HeadersFileReader } from "../services/HeadersFileReader.ts";

export class ServerStaticProvider {
  /**
   * Files a host reads as configuration, never serves: `/_headers`,
   * `/_redirects` and `/.assetsignore`. Hidden from a static server that
   * applies `_headers`, as Cloudflare and Bay hide them.
   */
  public static readonly CONFIG_FILES: readonly string[] = [
    "/_headers",
    "/_redirects",
    "/.assetsignore",
  ];

  /**
   * What Cloudflare answers for a file no `_headers` rule caches, and so what
   * every host answers once an app ships a `_headers`: keep it, and ask
   * before using it again.
   */
  public static readonly DEFAULT_CACHE_CONTROL =
    "public, max-age=0, must-revalidate";

  protected readonly alepha = $inject(Alepha);
  protected readonly routerProvider = $inject(ServerRouterProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly headersReader = $inject(HeadersFileReader);
  protected readonly log = $logger();
  protected readonly directories: ServeDirectory[] = [];

  /**
   * The `_headers` rules of every route a static server created with
   * `headersFile`, keyed by the route object itself: it is the one thing
   * `server:onResponse` hands back that says which server answered.
   */
  protected readonly headerRoutes = new WeakMap<
    object,
    { rules: HeadersRule[]; prefix: string }
  >();

  /**
   * Apply `_headers` to a response of a static server that has one.
   *
   * ## ⚠️ A hook, `last`, and never inside the file handler
   *
   * `ServerHelmetProvider` fills in its security headers from a
   * `server:onResponse` hook with `priority: "first"`, for every route,
   * static files included, and only where a header is absent. A rule's
   * `! X-Frame-Options` applied inside the handler would be put back by
   * helmet a moment later. Here the provider's own headers and helmet's are
   * the host defaults, and the rules go on top: Cloudflare's order.
   *
   * It covers every response those routes give: a file, the `index.html`
   * alias, the history fallback, a 304, a redirect.
   */
  protected readonly applyHeaders = $hook({
    on: "server:onResponse",
    priority: "last",
    handler: ({ route, request, response }) => {
      const entry = this.headerRoutes.get(route);
      if (!entry) {
        return;
      }
      const redirect =
        response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304;
      if (!redirect && !response.headers["cache-control"]) {
        response.headers["cache-control"] =
          ServerStaticProvider.DEFAULT_CACHE_CONTROL;
      }
      this.headersReader.apply(
        entry.rules,
        this.pathUnder(entry.prefix, request.url.pathname),
        response.headers,
      );
    },
  });

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
    let files = await fileSource.list();

    // `_headers`, read before anything is mounted, so an invalid file fails
    // the boot instead of a request.
    let rules: HeadersRule[] | undefined;
    if (options.headersFile) {
      files = files.filter(
        (it) => !ServerStaticProvider.CONFIG_FILES.includes(it),
      );
      rules = await this.readHeadersFile(
        fileSource,
        source ? "_headers (embedded)" : `${options.root ?? "."}/_headers`,
      );
    }
    // With rules, they decide what is cached; the extension-based header
    // below would only be a second opinion answering differently from
    // Cloudflare and Bay for the same file.
    const fileOptions: ServePrimitiveOptions = rules
      ? { ...options, cacheControl: false }
      : options;
    const mount = (route: {
      silent?: boolean;
      path: string;
      handler: ServerHandler;
    }) => {
      this.routerProvider.createRoute(route);
      if (rules) {
        this.headerRoutes.set(route, { rules, prefix });
      }
    };

    // 2. create a $route for each file (yes, this could be a lot of routes)
    const routes = (
      await Promise.all(
        files.map(async (urlPath) => {
          const handler = await this.createFileHandler(
            fileSource,
            urlPath,
            fileOptions,
          );
          return this.routePaths(prefix, urlPath).map((routePath) => {
            this.log.trace(`Mount ${routePath} -> ${urlPath}`);
            return { silent: options.silent, path: routePath, handler };
          });
        }),
      )
    ).flat();

    for (const route of routes) {
      mount(route);

      // if route is for index.html, also create a route without it
      // e.g. /my/path/index.html -> /my/path/
      if (
        options.indexFallback !== false &&
        route.path.endsWith("index.html")
      ) {
        mount({
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
      mount({
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
   * Every spelling of the URL a file answers under.
   *
   * The router matches a static segment as it arrives, still percent-encoded,
   * so a file is reachable only under the spellings mounted for it. Two are:
   *
   * - `encodeURI`, which leaves the reserved characters (`$`, `&`, `+`, ...)
   *   as they are, and is what a browser sends for a typed or pasted path;
   * - `encodeURIComponent` per segment, which escapes them, and is how
   *   `ReactPageProvider.compile` builds a link from a param.
   *
   * ⚠️ Both, because the prerender writes a page's DECODED pathname (what
   * Cloudflare and Bay look up, both decoding the request first), and the
   * router links the same page encoded: `reference-primitives-$sitemap.html`
   * is linked as `%24sitemap`. Mounting one spelling made the other a 404
   * here while both answered on every other host.
   */
  protected routePaths(prefix: string, urlPath: string): string[] {
    const under = (path: string) => `${prefix}${path}`.replace(/\/+/g, "/");
    const component = urlPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return [...new Set([under(encodeURI(urlPath)), under(component)])];
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
   * The rules of the source's `/_headers`, or `undefined` when it has none.
   *
   * Read through the source, never the disk directly: a compiled binary
   * carries the file inside itself.
   *
   * @throws {AlephaError} naming the line, for a file that does not parse.
   * The build validated it, so an invalid one is a hand-edited `dist`, and a
   * server started from it would disagree with Cloudflare and Bay.
   */
  protected async readHeadersFile(
    source: StaticFileSource,
    label: string,
  ): Promise<HeadersRule[] | undefined> {
    if (!(await source.has("/_headers"))) {
      return undefined;
    }
    const stream = await source.open("/_headers");
    if (!stream) {
      return undefined;
    }
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
      text +=
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    const rules = this.headersReader.read(text, label);
    this.log.debug(`Applying ${rules.length} _headers rules`, { label });
    return rules;
  }

  /**
   * A request path relative to the prefix a static server is mounted under,
   * still percent-encoded: `/static/app.js` under `/static` is `/app.js`.
   */
  protected pathUnder(prefix: string, pathname: string): string {
    const base = prefix.replace(/\/+$/, "");
    if (base === "" || !pathname.startsWith(base)) {
      return pathname;
    }
    const rest = pathname.slice(base.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
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
