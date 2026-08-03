#! /usr/bin/env node
import { access, readdir, readFile } from "node:fs/promises";
import * as os from "node:os";
import { dirname, join, resolve } from "node:path";
import { $inject, AlephaError, run, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import type { InlineConfig } from "tsdown";

interface Module {
  name: string;
  dependencies: string[];
  native?: boolean;
  browser?: boolean;
  workerd?: boolean;
  bun?: boolean;
  node?: boolean;
}

/**
 * Modules that are built but kept out of the `exports` map.
 *
 * They still need a `dist/` output — they are just not something a consumer
 * should be able to `import`.
 */
const NOT_EXPORTED = new Set(["bin"]);

class AlephaPackageBuilderCli {
  src = "src";
  dist = "dist";
  fs = $inject(FileSystemProvider);
  log = $logger();

  make = $command({
    root: true,
    flags: z.object({
      check: z
        .boolean()
        .describe(
          "Only analyze modules and refresh configs (package.json exports, tsconfig.json paths) without building",
        )
        .optional(),
      external: z
        .text({
          description:
            "Comma-separated additional external packages (e.g. --external=alepha,@alepha/ui/styles.css). Bare package names auto-expand to include all their subpath exports.",
        })
        .optional(),
    }),
    handler: async ({ run, root, flags }) => {
      const modules: Array<Module> = [];

      const pkgBuffer = await this.fs.readFile("package.json");
      const pkgData = JSON.parse(pkgBuffer.toString("utf-8"));
      const packageName = pkgData.name as string;

      await run("analyze modules", async () => {
        modules.push(
          ...(await analyzeModules(this.fs.join(root, this.src), packageName)),
        );
      });

      pkgData.exports = {};
      const publishExports: Record<string, any> = {};

      for (const item of modules) {
        // Built, but not part of the public surface. `bin` is the CLI entry
        // point: it boots Alepha and runs a command as a side effect of being
        // loaded, so `import("alepha/bin")` launched the whole CLI — which any
        // tool that walks the `exports` map does by accident. It is reached
        // through the `bin` field, which resolves as a file path and does not
        // consult `exports`, so dropping it here costs nothing.
        if (NOT_EXPORTED.has(item.name)) {
          continue;
        }

        let m = `./${item.name.replace("core", "")}`;
        if (m.endsWith("/")) m = m.slice(0, -1);
        const path = m;

        // Dev shape: package.json points at src so the monorepo works
        // without a build step. Order matters for resolver compatibility.
        pkgData.exports[path] = {};
        pkgData.exports[path].types = `./src/${item.name}/index.ts`;
        if (item.native) {
          pkgData.exports[path]["react-native"] =
            `./src/${item.name}/index.native.ts`;
        } else if (item.browser) {
          pkgData.exports[path]["react-native"] =
            `./src/${item.name}/index.browser.ts`;
        }

        if (item.workerd) {
          pkgData.exports[path].workerd = `./src/${item.name}/index.workerd.ts`;
        }

        if (item.browser) {
          pkgData.exports[path].browser = `./src/${item.name}/index.browser.ts`;
        }

        if (item.bun) {
          pkgData.exports[path].bun = `./src/${item.name}/index.bun.ts`;
        }

        pkgData.exports[path].import = `./src/${item.name}/index.ts`;
        pkgData.exports[path].default = `./src/${item.name}/index.ts`;

        // Publish shape: same structure but pointing at dist. yarn/npm
        // applies publishConfig fields at publish time, so consumers
        // installing from the registry receive the dist-mapped package.json.
        publishExports[path] = {};
        publishExports[path].types = `./dist/${item.name}/index.d.ts`;
        if (item.native) {
          publishExports[path]["react-native"] =
            `./dist/${item.name}/index.native.js`;
        } else if (item.browser) {
          publishExports[path]["react-native"] =
            `./dist/${item.name}/index.browser.js`;
        }

        if (item.workerd) {
          publishExports[path].workerd = `./dist/${item.name}/index.workerd.js`;
        }

        if (item.browser) {
          publishExports[path].browser = `./dist/${item.name}/index.browser.js`;
        }

        if (item.bun) {
          publishExports[path].bun = `./dist/${item.name}/index.bun.js`;
        }

        publishExports[path].import = `./dist/${item.name}/index.js`;
        publishExports[path].default = `./dist/${item.name}/index.js`;
      }

      if (packageName === "alepha") {
        pkgData.exports["./tsconfig.base"] = "./tsconfig.base.json";
        pkgData.exports["./package.json"] = "./package.json";
        publishExports["./tsconfig.base"] = "./tsconfig.base.json";
        publishExports["./package.json"] = "./package.json";
      }

      // publishConfig is honored by yarn/npm at publish time and overrides
      // the matching top-level fields in the published package.json. The
      // dev package.json keeps src-pointing fields so the monorepo works
      // build-free; consumers installing from the registry get the dist
      // shape automatically.
      const toDistPath = (value: string) =>
        value
          .replace("/src/", "/dist/")
          .replace(/\.tsx?$/, value.includes("/index.") ? ".js" : ".js");
      const toDistTypes = (value: string) =>
        value.replace("/src/", "/dist/").replace(/\.tsx?$/, ".d.ts");
      const remapBin = (bin: unknown): unknown => {
        if (typeof bin === "string") return toDistPath(bin);
        if (bin && typeof bin === "object") {
          return Object.fromEntries(
            Object.entries(bin as Record<string, string>).map(([k, v]) => [
              k,
              toDistPath(v),
            ]),
          );
        }
        return bin;
      };

      pkgData.publishConfig = {
        ...(pkgData.publishConfig ?? {}),
        ...(pkgData.main ? { main: toDistPath(pkgData.main) } : {}),
        ...(pkgData.types ? { types: toDistTypes(pkgData.types) } : {}),
        ...(pkgData.bin ? { bin: remapBin(pkgData.bin) } : {}),
        exports: publishExports,
      };

      await this.fs.writeFile(
        "package.json",
        `${JSON.stringify(pkgData, null, 2)}\n`,
      );

      if (flags.check) {
        this.log.info(`Checked ${modules.length} modules, configs refreshed`);
        return;
      }

      const tmpDir = this.fs.join(root, "node_modules/.alepha");
      await this.fs.mkdir(tmpDir, { recursive: true }).catch(() => {});

      await this.fs.writeFile(
        this.fs.join(tmpDir, "module-dependencies.json"),
        JSON.stringify(modules, null, 2),
      );

      const flagExternals = (flags.external ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const external: (string | RegExp)[] = [
        "bun",
        "bun:sqlite",
        // `cloudflare:workers` only exists inside a Cloudflare Workers isolate
        // at runtime (used by AlephaWebSocketDurableObject); it must never be
        // bundled/resolved by rolldown.
        "cloudflare:workers",
        // zod is a runtime dependency, never bundled. Its `v4/locales/*.d.cts`
        // type files use CommonJS dts syntax that rolldown-plugin-dts cannot
        // bundle, so it must be external for both the JS and the .d.ts builds.
        toExternalPattern("zod"),
        toExternalPattern(packageName),
        // `vite` bundles a copy of `postcss` whose .d.ts uses
        // `import { atRule, AtRule, ... }` (no `type` modifier), which
        // rolldown's dts bundler rejects with [MISSING_EXPORT].
        toExternalPattern("vite"),
        // Types-only package: rolldown's dts bundler can't import its
        // interfaces (e.g. `R2Bucket`) as values.
        toExternalPattern("@cloudflare/workers-types"),
        ...flagExternals.map(toExternalPattern),
      ];

      await run.rm(this.dist);

      const build = async (item: Module) => {
        const entries: InlineConfig[] = [];
        const src = this.fs.join(root, this.src, item.name);
        const dest = this.fs.join(root, this.dist, item.name);

        entries.push({
          entry: this.fs.join(src, "index.ts"),
          outDir: dest,
          format: ["esm"],
          sourcemap: true,
          fixedExtension: false,
          platform: "node", // TODO: node must be enabled only if index.node.ts exists
          deps: {
            neverBundle: external,
            // tsdown externalizes the .d.ts bundle separately — without this,
            // bundling pulls in zod's CommonJS `v4/locales/*.d.cts` which
            // rolldown-plugin-dts cannot bundle.
            dts: { neverBundle: external },
          },
          dts: {
            sourcemap: true,
          },
        });

        const deps = {
          neverBundle: external,
          dts: { neverBundle: external },
        };

        if (item.workerd) {
          entries.push({
            entry: this.fs.join(src, "index.workerd.ts"),
            outDir: dest,
            platform: "neutral",
            sourcemap: true,
            dts: false,
            deps,
            inputOptions: {
              resolve: {
                // platform: "neutral" defaults mainFields to [], so packages
                // without an "exports" field (like worker-mailer) won't resolve.
                // We need to explicitly set mainFields to check module/main.
                mainFields: ["workerd", "module", "main"],
              },
            },
            fixedExtension: false,
          });
        }

        if (item.native) {
          entries.push({
            entry: this.fs.join(src, "index.native.ts"),
            outDir: dest,
            platform: "neutral",
            sourcemap: true,
            dts: false,
            deps,
          });
        }

        if (item.browser) {
          entries.push({
            entry: this.fs.join(src, "index.browser.ts"),
            outDir: dest,
            platform: "browser",
            sourcemap: true,
            dts: false,
            deps,
          });
        }

        if (item.bun) {
          entries.push({
            entry: this.fs.join(src, "index.bun.ts"),
            outDir: dest,
            platform: "node",
            sourcemap: true,
            fixedExtension: false,
            dts: false,
            deps,
          });
        }

        const config = this.fs.join(
          tmpDir,
          `tsdown-${item.name.replace("/", "-")}.config.js`,
        );
        await this.fs.writeFile(
          config,
          `export default ${stringify(entries)};`,
        );

        // /!\ Warning /!\
        // avoid to call tsdown programmatically, when we spawn 8 processes at once it 'JavaScript heap out of memory' :---)
        await run(`npx tsdown -c=${config}`);
      };

      // tsdown/rolldown already saturates all cores *within* a single build,
      // so process-level concurrency must stay LOW — it must not scale with
      // core count. `os.cpus().length / 2` (7 on a 14-core box) oversubscribes
      // the CPU with ~7 internally-threaded builds fighting over the same
      // cores plus memory pressure: every ~1s build balloons to ~25s and the
      // whole package takes ~4.6min. A small fixed cap keeps rolldown's own
      // threads fed while a couple of single-threaded startup/npx phases
      // overlap — ~1.2min for the same output (measured ~3.7x faster).
      const concurrency = Math.max(1, Math.min(3, os.cpus().length));
      const queue = modules.slice();
      const workers: Promise<void>[] = [];
      for (let i = 0; i < concurrency; i++) {
        const worker = (async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (item) {
              await build(item);
            } else {
              await new Promise((r) => setTimeout(r, 100));
            }
          }
        })();
        workers.push(worker);
      }
      await Promise.all(workers);
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------

run(AlephaPackageBuilderCli, {
  env: {
    LOG_FORMAT: "raw",
    LOG_LEVEL: "alepha.command:info,warn",
  },
});

// ---------------------------------------------------------------------------
// Module analysis utilities
// ---------------------------------------------------------------------------

/**
 * Build a regex matching a package name and all its sub-paths
 * (e.g. `vite` matches `vite`, `vite/client`, `vite/dist/...`).
 */
function toExternalPattern(pkg: string): RegExp {
  return new RegExp(`^${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`);
}

/**
 * JSON.stringify with RegExp support — emits `new RegExp(...)` so
 * externalization patterns survive the round-trip through the config file
 * loaded by `npx tsdown -c=...`.
 */
function stringify(value: unknown): string {
  const TAG = "__REGEX__";
  const json = JSON.stringify(
    value,
    (_, v) =>
      v instanceof RegExp ? `${TAG}${v.source}${TAG}${v.flags}${TAG}` : v,
    2,
  );
  return json.replace(
    new RegExp(`"${TAG}(.*?)${TAG}(.*?)${TAG}"`, "g"),
    (_, source, flags) =>
      `new RegExp(${JSON.stringify(JSON.parse(`"${source}"`))}, ${JSON.stringify(flags)})`,
  );
}

async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  await scan(dir);
  return files;
}

function removeComments(content: string): string {
  // Remove single-line comments
  let cleaned = content.replace(/\/\/.*$/gm, "");

  // Remove multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove template literal (`)
  cleaned = cleaned.replace(/`[\s\S]*?`/g, (match) => {
    return match.replace(/from\s+["'][^"']+["'];/g, "");
  });

  return cleaned;
}

function extractAlephaDependencies(
  content: string,
  packageName: string,
): string[] {
  const deps = new Set<string>();
  const cleanedContent = removeComments(content);

  // Match: from "alepha/xxx" or from 'alepha/xxx'
  const importRegex = new RegExp(
    `from "${packageName}/([a-zA-Z0-9_/]+)";`,
    "g",
  );

  const matches = cleanedContent.matchAll(importRegex);
  for (const match of matches) {
    deps.add(match[1]);
  }

  return Array.from(deps);
}

/**
 * Detect relative imports that escape the module boundary.
 *
 * For example, a file in `cli/` importing `../../core/xxx` is invalid —
 * it must use `"alepha"` or `"alepha/core"` instead. Cross-module relative
 * imports cause tsdown to inline the dependency, creating duplicate classes,
 * symbols, and module-scoped state that breaks at runtime.
 */
function detectEscapingImports(
  content: string,
  filePath: string,
  modulePath: string,
  moduleName: string,
): void {
  // Skip test files — they are never bundled by tsdown
  if (/\.spec\.(ts|tsx)$/.test(filePath)) return;

  const cleanedContent = removeComments(content);

  const importRegex = /from\s+["'](\.\.?\/[^"']+)["']/g;
  const fileDir = dirname(filePath);

  for (const match of cleanedContent.matchAll(importRegex)) {
    const importPath = match[1];
    const resolved = resolve(fileDir, importPath);

    if (!resolved.startsWith(modulePath)) {
      const relative = importPath.replace(/\.(ts|tsx)$/, "");
      throw new AlephaError(
        `Cross-module relative import '${relative}' in module '${moduleName}' (${filePath}). ` +
          `Relative imports must stay within the module boundary. Use a package import instead (e.g., "alepha" or "alepha/xxx").`,
      );
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function detectCircularDependencies(modules: Module[]): void {
  const moduleMap = new Map(modules.map((m) => [m.name, m.dependencies]));

  function hasCycle(
    moduleName: string,
    visited: Set<string> = new Set(),
    path: string[] = [],
  ): string[] | null {
    if (visited.has(moduleName)) {
      const cycleStart = path.indexOf(moduleName);
      return [...path.slice(cycleStart), moduleName];
    }

    const deps = moduleMap.get(moduleName);
    if (!deps) return null;

    visited.add(moduleName);
    path.push(moduleName);

    for (const dep of deps) {
      const cycle = hasCycle(dep, new Set(visited), [...path]);
      if (cycle) return cycle;
    }

    return null;
  }

  for (const module of modules) {
    const cycle = hasCycle(module.name);
    if (cycle) {
      throw new AlephaError(
        `Circular dependency detected: ${cycle.join(" -> ")}`,
      );
    }
  }
}

export async function analyzeModules(
  srcDir: string,
  packageName: string,
): Promise<Module[]> {
  const modules: Module[] = [];

  async function scanDirectory(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const moduleName = prefix ? `${prefix}/${entry.name}` : entry.name;
        const modulePath = join(dir, entry.name);

        // Check if this directory has an index.ts (is a module)
        const hasIndex = await fileExists(join(modulePath, "index.ts"));

        if (hasIndex) {
          // This is a module
          const dependencies = new Set<string>();

          // Check for browser/node/bun entry points
          const hasBrowser = await fileExists(
            join(modulePath, "index.browser.ts"),
          );
          const hasNative = await fileExists(
            join(modulePath, "index.native.ts"),
          );
          const hasBun = await fileExists(join(modulePath, "index.bun.ts"));
          const hasNode = await fileExists(join(modulePath, "index.node.ts"));
          const hasEdge = await fileExists(
            join(modulePath, "index.workerd.ts"),
          );

          // Get all .ts/.tsx files in this module
          const files = await getAllFiles(modulePath);

          for (const file of files) {
            const content = await readFile(file, "utf-8");
            detectEscapingImports(content, file, modulePath, moduleName);
            const deps = extractAlephaDependencies(content, packageName);
            for (const dep of deps) {
              if (dep.endsWith(".ts")) {
                throw new Error(
                  `Invalid dependency '${dep}' in module '${moduleName}'. Do not include file extensions in Alepha module imports.`,
                );
              }
              if (dep.includes("-")) {
                throw new Error(
                  `Invalid dependency '${dep}' in module '${moduleName}'. Use '/' instead of '-' in Alepha module imports.`,
                );
              }
              dependencies.add(dep);
            }
          }

          const module: Module = {
            name: moduleName,
            dependencies: Array.from(dependencies),
          };

          if (hasNative) module.native = true;
          if (hasEdge) module.workerd = true;
          if (hasBrowser) module.browser = true;
          if (hasBun) module.bun = true;
          if (hasNode) module.node = true;

          modules.push(module);
        } else {
          // No index.ts, check subdirectories for modules
          await scanDirectory(modulePath, moduleName);
        }
      }
    }
  }

  await scanDirectory(srcDir, "");

  // Check for circular dependencies
  detectCircularDependencies(modules);

  return modules;
}
