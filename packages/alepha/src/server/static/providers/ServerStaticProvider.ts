import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, sep } from "node:path";
import type { Readable as NodeStream } from "node:stream";

import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { type ServerHandler, ServerRouterProvider } from "alepha/server";
import { FileDetector } from "alepha/system";

import { $serve, type ServePrimitiveOptions } from "../primitives/$serve.ts";

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

  public async createStaticServer(
    options: ServePrimitiveOptions,
  ): Promise<void> {
    const prefix = options.path ?? "/";

    let root = options.root ?? process.cwd();
    if (!isAbsolute(root)) {
      root = join(process.cwd(), root);
    }

    this.log.debug("Serve static files", { prefix, root });

    await stat(root);

    // 1. get all files in the root directory (recursively)
    const files = await this.getAllFiles(root, options.ignoreDotEnvFiles);

    // 2. create a $route for each file (yes, this could be a lot of routes)
    const routes = await Promise.all(
      files.map(async (file) => {
        // Normalize to forward slashes for URL paths
        const urlPath = file.replace(root, "").replace(/\\/g, "/");
        const routePath = `${prefix}${encodeURI(urlPath)}`.replace(/\/+/g, "/");
        const filePath = join(root, urlPath.replace(/\//g, sep));
        this.log.trace(`Mount ${routePath} -> ${filePath}`);
        return {
          silent: options.silent,
          path: routePath,
          handler: await this.createFileHandler(filePath, options),
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
    this.directories.push({
      options,
      files: files.map((file) => file.replace(root, "").replace(/\\/g, "/")),
    });

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

          reply.headers["content-type"] = "text/html";
          reply.status = 200;

          return new Promise<any>((resolve, reject) => {
            const stream = createReadStream(join(root, "index.html"));
            stream.on("open", () => {
              resolve(stream);
            });
            stream.on("error", (err) => {
              reject(err);
            });
          });
        },
      });
    }
  }

  public async createFileHandler(
    filepath: string,
    options: ServePrimitiveOptions,
  ): Promise<ServerHandler> {
    const filename = basename(filepath);

    const hasGzip = await access(`${filepath}.gz`)
      .then(() => true)
      .catch(() => false);

    const hasBr = await access(`${filepath}.br`)
      .then(() => true)
      .catch(() => false);

    const fileStat = await stat(filepath);
    const lastModified = fileStat.mtime.toUTCString();
    const etag = `"${fileStat.size}-${fileStat.mtime.getTime()}"`;
    const contentType = this.fileDetector.getContentType(filename);
    const cacheControl = this.getCacheControl(filename, options);

    return async (request): Promise<NodeStream | undefined> => {
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
        reply.headers.vary = "accept-encoding";
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
      if (
        headers["if-none-match"] === variantEtag ||
        headers["if-modified-since"] === lastModified
      ) {
        reply.status = 304;
        return;
      }

      return new Promise<any>((resolve, reject) => {
        const stream = createReadStream(path);
        stream.on("open", () => {
          resolve(stream);
        });
        stream.on("error", (err: NodeJS.ErrnoException) => {
          // Metadata is captured once at boot, so a file deleted afterwards
          // still routes here — and a raw stream error surfaced as a 500.
          // A missing file is a 404.
          if (err?.code === "ENOENT") {
            reply.status = 404;
            resolve(undefined);
            return;
          }
          reject(err);
        });
      });
    };
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
          maxAge: this.dateTimeProvider
            .duration(options.cacheControl.maxAge ?? [30, "days"])
            .as("seconds"),
        };
      }
    }
  }

  public async getAllFiles(
    dir: string,
    ignoreDotEnvFiles = true,
  ): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (dirent) => {
        // skip .env & other dot files
        if (ignoreDotEnvFiles && dirent.name.startsWith(".")) {
          return [];
        }

        const fullPath = join(dir, dirent.name);
        return dirent.isDirectory() ? this.getAllFiles(fullPath) : fullPath;
      }),
    );

    return files.flat();
  }
}

export interface ServeDirectory {
  options: ServePrimitiveOptions;
  files: string[];
}
