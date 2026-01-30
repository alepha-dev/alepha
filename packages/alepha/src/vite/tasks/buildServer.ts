import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Alepha, AlephaError } from "alepha";
import type * as vite from "vite";
import type { UserConfig } from "vite";
import { analyzer as viteAnalyzer } from "vite-bundle-analyzer";
import { createBufferedLogger } from "../helpers/createBufferedLogger.ts";
import { importVite } from "../helpers/importVite.ts";
import { importViteReact } from "../helpers/importViteReact.ts";
import { viteAlephaSsrPreload } from "../plugins/viteAlephaSsrPreload.ts";
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
   * If provided, the SSR manifest will be embedded in the server output.
   */
  clientDir?: string;

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

  /**
   * Add more entry point conditions for SSR module resolution (e.g., "bun").
   */
  conditions?: string[];

  /**
   * Alepha instance to set SSR manifest for pre-rendering.
   */
  alepha: Alepha;
}

export interface BuildServerResult {
  /**
   * The filename of the built server entry (e.g., "abc123.js").
   */
  entryFile: string;

  /**
   * SSR manifest data for module preloading.
   * Can be used to set in alepha store for pre-rendering.
   */
  manifest?: {
    base?: string;
    client?: Record<string, any>;
    preload?: Record<string, string>;
  };
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
  const { build: viteBuild, resolveConfig } = await importVite();
  const plugins: any[] = [];

  const viteReact = await importViteReact();
  if (viteReact && opts.clientDir) {
    plugins.push(viteReact());
  }

  plugins.push(viteAlephaSsrPreload());

  if (opts.stats) {
    plugins.push(
      viteAnalyzer({
        analyzerMode: "static",
      }),
    );
  }

  // Create buffered logger for silent mode
  const logger = opts.silent ? createBufferedLogger() : undefined;

  const conditions = ["node", "import", "module", "default"];
  if (opts.conditions) {
    conditions.unshift(...opts.conditions);
  }

  // note: we still can override this config via config file (vite.config.ts)
  const viteBuildServerConfig: UserConfig = {
    mode: "production",
    logLevel: opts.silent ? "silent" : undefined,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    publicDir: false,
    ssr: {
      noExternal: true,
      resolve: { conditions },
    },
    build: {
      sourcemap: true,
      ssr: opts.entry,
      outDir: `${opts.distDir}/server`,
      minify: true,
      chunkSizeWarningLimit: 10000,
      rollupOptions: {
        external: [/^bun(:|$)/, /^cloudflare:/],
        output: {
          entryFileNames: "[hash].js",
          chunkFileNames: "[hash].js",
          assetFileNames: "[hash][extname]",
          format: "esm",
        },
      },
    },
    esbuild: { legalComments: "none", keepNames: true },
    customLogger: logger, // mock logger to avoid noisy output
    plugins,
  };

  // create inline config by merging alepha built-in + extended config

  let result: vite.Rollup.RollupOutput | vite.Rollup.RollupOutput[];
  try {
    result = (await viteBuild(viteBuildServerConfig)) as
      | vite.Rollup.RollupOutput
      | vite.Rollup.RollupOutput[];
  } catch (error) {
    // flush buffered logs on failure so user can see what happened
    logger?.flush();
    throw error;
  }

  // resolve final config to read externals
  const resolvedConfig = await resolveConfig(viteBuildServerConfig, "build");

  // extract resolved config to get externals
  const externals: string[] = [];

  if (Array.isArray(resolvedConfig?.ssr?.external)) {
    externals.push(...resolvedConfig.ssr.external);
  }

  // Generate package.json with externals
  await generateExternals({
    distDir: opts.distDir,
    externals,
  });

  const entryFile = extractEntryFromBundle(opts.entry, result);

  // Embed SSR manifests if client was built
  // This bundles all manifest data into index.js for serverless deployments
  let manifest = "";
  let manifestData:
    | {
        base?: string;
        client?: Record<string, any>;
        preload?: Record<string, string>;
      }
    | undefined;

  if (opts.clientDir) {
    const viteDir = `${opts.distDir}/${opts.clientDir}/.vite`;
    const clientManifest = await loadJsonFile(`${viteDir}/manifest.json`);
    const preloadManifest = await loadJsonFile(
      `${viteDir}/preload-manifest.json`,
    );

    // Strip unused fields from client manifest to reduce bundle size
    const strippedClientManifest = stripClientManifest(clientManifest);

    // Get base path from resolved config (defaults to "/" if not set)
    // Normalize: ensure it starts with "/" and doesn't end with "/" (unless it's just "/")
    let base = resolvedConfig.base || "/";
    if (!base.startsWith("/")) {
      base = `/${base}`;
    }
    if (base.length > 1 && base.endsWith("/")) {
      base = base.slice(0, -1);
    }

    manifestData = {
      base: base !== "/" ? base : undefined, // Only include if not default
      client: strippedClientManifest,
      preload: preloadManifest,
    };

    manifest = `__alepha.set("alepha.react.ssr.manifest", ${JSON.stringify(manifestData)});\n`;

    // Set manifest in alepha store for pre-rendering
    opts.alepha.store.set("alepha.react.ssr.manifest" as any, manifestData);

    // Remove .vite directory - no longer needed at runtime
    await rm(viteDir, { recursive: true, force: true });
  }

  const warning =
    "// This file was automatically generated. DO NOT MODIFY." +
    "\n" +
    "// Changes to this file will be lost when the code is regenerated.\n";

  await writeFile(
    `${opts.distDir}/index.js`,
    `${warning}\n${manifest}import './server/${entryFile}';\n`.trim(),
  );

  return { entryFile, manifest: manifestData };
}

/**
 * Load a JSON file, returning undefined if it doesn't exist.
 */
async function loadJsonFile(path: string): Promise<any> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Strip unused fields from client manifest to reduce bundle size.
 * Only keeps: file, isEntry, imports, css
 */
function stripClientManifest(
  manifest: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (!manifest) return undefined;

  const stripped: Record<string, any> = {};
  for (const [key, entry] of Object.entries(manifest)) {
    stripped[key] = {
      file: entry.file,
      ...(entry.isEntry && { isEntry: entry.isEntry }),
      ...(entry.imports?.length && { imports: entry.imports }),
      ...(entry.css?.length && { css: entry.css }),
    };
  }
  return stripped;
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
