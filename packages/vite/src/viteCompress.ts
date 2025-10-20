import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type BrotliOptions,
  brotliCompress as brotliCompressCb,
  gzip as gzipCb,
  type ZlibOptions,
} from "node:zlib";
import type { Plugin } from "vite";

const gzipCompress = promisify(gzipCb);
const brotliCompress = promisify(brotliCompressCb);

export interface ViteCompressOptions {
  /**
   * If true, the plugin will not compress the files.
   *
   * @default false
   */
  disabled?: boolean;

  /**
   * If true, the plugin will compress the files using brotli.
   * Can also be an object with brotli options.
   *
   * @default true
   */
  brotli?: boolean | BrotliOptions;

  /**
   * If true, the plugin will compress the files using gzip.
   * Can also be an object with gzip options.
   *
   * @default true
   */
  gzip?: boolean | ZlibOptions;

  /**
   * A filter to determine which files to compress.
   * Can be a RegExp or a function that returns true for files to compress.
   *
   * @default /\.(js|mjs|cjs|css|wasm|svg|html)$/
   */
  filter?: RegExp | ((fileName: string) => boolean);
}

export function viteCompress(options: ViteCompressOptions = {}): Plugin {
  const { disabled = false, filter = /\.(js|mjs|cjs|css|wasm|svg)$/ } = options;

  return {
    name: "compress",
    apply: "build",
    async writeBundle(outputOptions, bundle) {
      if (disabled) {
        return;
      }

      const now = Date.now();

      const outputDir = outputOptions.dir || resolve(process.cwd(), "dist");

      const files = Object.keys(bundle)
        .filter((fileName) => {
          // [feature]: filter
          if (typeof filter === "function") {
            return filter(fileName);
          }
          return filter.test(fileName);
        })
        .map((fileName) => ({
          fileName,
          filePath: join(outputDir, fileName),
        }));

      // Compress each file
      const compressionTasks: Promise<void>[] = [];

      for (const { filePath } of files) {
        compressionTasks.push(compressFile(options, filePath));
      }

      // Wait for all compression tasks to complete
      await Promise.all(compressionTasks);

      this.info(
        `Compressed ${files.length} file${files.length > 1 ? "s" : ""} in ${Date.now() - now}ms.`,
      );
    },
  };
}

export async function compressFile(
  options: ViteCompressOptions = {},
  filePath: string,
) {
  const { brotli = true, gzip = true } = options;

  const compressionTasks: Promise<void>[] = [];

  const fileContentPromise = fs.readFile(filePath);

  if (gzip) {
    const gzipOptions =
      typeof gzip === "object"
        ? gzip
        : {
            level: 9, // default gzip compression level
          };
    compressionTasks.push(
      fileContentPromise.then(async (content) => {
        const compressed = await gzipCompress(content, gzipOptions);
        await fs.writeFile(`${filePath}.gz`, compressed);
      }),
    );
  }

  if (brotli) {
    const brotliOptions = typeof brotli === "object" ? brotli : {};
    compressionTasks.push(
      fileContentPromise.then(async (content) => {
        const compressed = await brotliCompress(content, brotliOptions);
        await fs.writeFile(`${filePath}.br`, compressed);
      }),
    );
  }

  await Promise.all(compressionTasks);
}
