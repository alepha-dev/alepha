import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AlephaError } from "alepha";
import type * as vite from "vite";
import type { UserConfig } from "vite";
import { analyzer as viteAnalyzer } from "vite-bundle-analyzer";
import { createBufferedLogger } from "../helpers/createBufferedLogger.ts";
import { importVite } from "../helpers/importVite.ts";
import { generateExternals } from "./generateExternals.ts";

export interface BuildServerOptions {
  /**
   * Path to the server entry file.
   */
  entry: string;

  /**
   * Output directory for server build.
   */
  distDir: string;

  /**
   * Optional client directory name (relative to distDir).
   * If provided, the client template will be embedded in the server output.
   */
  clientDir?: string;

  /**
   * Override Vite config options.
   */
  config?: UserConfig;

  /**
   * If true, generate build stats report.
   */
  stats?: boolean;

  /**
   * If true, suppress build output. Logs are buffered and only shown on failure.
   *
   * @default false
   */
  silent?: boolean;
}

export interface BuildServerResult {
  /**
   * The filename of the built server entry (e.g., "abc123.js").
   */
  entryFile: string;
}

/**
 * Build server-side SSR bundle with Vite.
 *
 * This task compiles the server code for production,
 * generates the externals package.json, and creates
 * the dist/index.js entry wrapper.
 */
export async function buildServer(
  opts: BuildServerOptions,
): Promise<BuildServerResult> {
  const { build: viteBuild, mergeConfig } = await importVite();
  const plugins: any[] = [];

  if (opts.stats) {
    plugins.push(
      viteAnalyzer({
        analyzerMode: "static",
      }),
    );
  }

  // Create buffered logger for silent mode
  const logger = opts.silent ? createBufferedLogger() : undefined;

  const viteBuildServerConfig: UserConfig = {
    mode: "production",
    logLevel: opts.silent ? "silent" : undefined,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    publicDir: false,
    ssr: {
      noExternal: true,
    },
    build: {
      sourcemap: true, // or "hidden" if you don't want to expose source maps
      ssr: opts.entry,
      outDir: `${opts.distDir}/server`,
      minify: true,
      chunkSizeWarningLimit: 10000,
      rollupOptions: {
        external: ["bun"],
        output: {
          entryFileNames: "[hash].js",
          chunkFileNames: "[hash].js",
          assetFileNames: "[hash][extname]",
          format: "esm",
        },
      },
    },
    esbuild: { legalComments: "none", keepNames: true },
    customLogger: logger,
    plugins,
  };

  let result: vite.Rollup.RollupOutput | vite.Rollup.RollupOutput[];
  try {
    result = (await viteBuild(
      mergeConfig(viteBuildServerConfig, opts.config || {}),
    )) as vite.Rollup.RollupOutput | vite.Rollup.RollupOutput[];
  } catch (error) {
    // Flush buffered logs on failure so user can see what happened
    logger?.flush();
    throw error;
  }

  // Extract resolved config to get externals
  const resolvedConfig = (result as any).resolvedConfig;
  const externals: string[] = resolvedConfig?.ssr?.external ?? [];

  // Generate package.json with externals
  await generateExternals({
    distDir: opts.distDir,
    externals,
  });

  const entryFile = extractEntryFromBundle(opts.entry, result);

  // Embed client template if client was built
  let template = "";
  if (opts.clientDir) {
    const index = await readFile(
      `${opts.distDir}/${opts.clientDir}/index.html`,
      "utf-8",
    );
    template = `__alepha.set("alepha.react.server.template", \`${index.replace(/>\s*</g, "><").trim()}\`);\n`;
  }

  const warning =
    "// This file was automatically generated. DO NOT MODIFY." +
    "\n" +
    "// Changes to this file will be lost when the code is regenerated.\n";

  await writeFile(
    `${opts.distDir}/index.js`,
    `${warning}\nimport './server/${entryFile}';\n\n${template}`.trim(),
  );

  return { entryFile };
}

/**
 * Extract entry filename from Vite build result.
 */
function extractEntryFromBundle(
  entry: string,
  result:
    | vite.Rollup.RollupOutput
    | vite.Rollup.RollupOutput[]
    | vite.Rollup.RollupWatcher,
): string {
  const entryFilePath = entry.startsWith("/")
    ? entry
    : join(process.cwd(), entry);

  const rollupOutput = (
    Array.isArray(result) ? result[0] : result
  ) as vite.Rollup.RollupOutput;

  const entryFile = rollupOutput.output.find(
    (it) => "facadeModuleId" in it && it.facadeModuleId === entryFilePath,
  )?.fileName;

  if (!entryFile) {
    throw new AlephaError(
      `Could not find the entry file "${entryFilePath}" in the build output. Please check your entry file and try again.`,
    );
  }

  return entryFile;
}
