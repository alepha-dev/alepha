import { promisify } from "node:util";
import {
  type BrotliOptions,
  brotliCompress as brotliCompressCb,
  gzip as gzipCb,
  type ZlibOptions,
} from "node:zlib";

import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

export interface CompressOptions {
  /**
   * Enable brotli compression. Can be true or brotli-specific options.
   *
   * @default true
   */
  brotli?: boolean | BrotliOptions;

  /**
   * Enable gzip compression. Can be true or gzip-specific options.
   *
   * @default false
   */
  gzip?: boolean | ZlibOptions;

  /**
   * Filter which files to compress.
   * Can be a RegExp or a function that returns true for files to compress.
   *
   * @default /\.(js|mjs|cjs|css|wasm|svg|html|xml)$/
   */
  filter?: RegExp | ((fileName: string) => boolean);
}

/**
 * Compresses all matching files in the public output directory.
 *
 * Creates .gz and .br copies alongside each matching file.
 * Runs as the LAST step in the build pipeline, after all other tasks
 * have written their files.
 */
export class BuildCompressTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly gzipCompress = promisify(gzipCb);
  protected readonly brotliCompress = promisify(brotliCompressCb);
  protected readonly defaultFilter = /\.(js|mjs|cjs|css|wasm|svg|html|xml)$/;

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.flags?.prebuilt) {
      return;
    }
    // Cloudflare Workers Static Assets compresses at the edge and has no
    // filename negotiation — there is no request that can ever reach a `.br`
    // sidecar as an encoding. Uploading them anyway made a third of the asset
    // manifest dead weight (651 of 1349 files for the docs app) and published
    // every one of them as its own fetchable URL.
    //
    // Guarded on the target rather than exposed as an option, because it is
    // not a preference: the sidecars are unusable there, so no app would ever
    // choose otherwise. Node and Bay keep them — the Alepha server does serve
    // a `.br` in place of recompressing per request.
    if (ctx.options.target === "cloudflare") {
      return;
    }
    // `hasClient` asks whether ALEPHA bundled a client, which is false for a
    // site adopted through `static.source` — nothing here was bundled, the
    // files were built by the workspace itself. They still need the `.br`/`.gz`
    // sidecars a static host serves in place of recompressing per request, so
    // an adopted client is the second way to have something worth compressing.
    if (!ctx.hasClient && !ctx.options.static?.source) {
      return;
    }

    const dist = ctx.options.output?.dist ?? "dist";
    const pub = ctx.options.output?.public ?? "public";
    const dir = this.fs.join(ctx.root, dist, pub);

    const hasDir = await this.fs.exists(dir);
    if (!hasDir) {
      return;
    }

    await ctx.run({
      name: "compress assets",
      handler: async () => {
        await this.compressDirectory(dir);
      },
    });
  }

  /**
   * Compress all matching files in a directory (recursive).
   */
  protected async compressDirectory(
    dir: string,
    options?: CompressOptions,
  ): Promise<number> {
    const filter = options?.filter ?? this.defaultFilter;
    const files = await this.fs.ls(dir, { recursive: true });

    const matchingFiles = files.filter((fileName) => {
      if (typeof filter === "function") {
        return filter(fileName);
      }
      return filter.test(fileName);
    });

    const tasks: Promise<void>[] = [];
    for (const fileName of matchingFiles) {
      tasks.push(this.compressFile(this.fs.join(dir, fileName), options));
    }

    await Promise.all(tasks);
    return matchingFiles.length;
  }

  /**
   * Compress a single file. Creates .gz and .br alongside original.
   */
  protected async compressFile(
    filePath: string,
    options?: CompressOptions,
  ): Promise<void> {
    const { brotli = true, gzip = false } = options ?? {};
    const tasks: Promise<void>[] = [];
    const contentPromise = this.fs.readFile(filePath);

    if (gzip) {
      const gzipOptions = typeof gzip === "object" ? gzip : { level: 9 };
      tasks.push(
        // Sequencing, not a pipeline: the chain's value is never read, only
        // awaited, so there is nothing for this callback to hand on.
        // oxlint-disable-next-line promise/always-return
        contentPromise.then(async (content) => {
          const compressed = await this.gzipCompress(content, gzipOptions);
          await this.fs.writeFile(`${filePath}.gz`, compressed);
        }),
      );
    }

    if (brotli) {
      const brotliOptions = typeof brotli === "object" ? brotli : {};
      tasks.push(
        // Sequencing, not a pipeline: the chain's value is never read, only
        // awaited, so there is nothing for this callback to hand on.
        // oxlint-disable-next-line promise/always-return
        contentPromise.then(async (content) => {
          const compressed = await this.brotliCompress(content, brotliOptions);
          await this.fs.writeFile(`${filePath}.br`, compressed);
        }),
      );
    }

    await Promise.all(tasks);
  }
}
