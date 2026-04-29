#! /usr/bin/env node
import { access, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as os from "node:os";
import { dirname, join, resolve } from "node:path";
import { $inject, AlephaError, run, t } from "alepha";
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

class AlephaPackageBuilderCli {
  src = "src";
  dist = "dist";
  fs = $inject(FileSystemProvider);
  log = $logger();

  make = $command({
    root: true,
    flags: t.object({
      check: t.optional(
        t.boolean({
          description:
            "Only analyze modules and refresh configs (package.json exports, tsconfig.json paths) without building",
        }),
      ),
      external: t.optional(
        t.text({
          description:
            "Comma-separated additional external packages (e.g. --external=alepha,@alepha/ui/styles.css). Bare package names auto-expand to include all their subpath exports.",
        }),
      ),
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

      for (const item of modules) {
        let m = `./${item.name.replace("core", "")}`;
        if (m.endsWith("/")) m = m.slice(0, -1);
        const path = m;

        pkgData.exports[path] = {};
        // order is important here for compatibility
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
      }

      if (packageName === "alepha") {
        pkgData.exports["./tsconfig.base"] = "./tsconfig.base.json";
        pkgData.exports["./package.json"] = "./package.json";
      }

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

      const external: (string | RegExp)[] = modules.map((it) => {
        if (it.name.endsWith("core")) {
          return `${packageName}/${it.name.replace("core", "")}`.slice(0, -1);
        }

        return `${packageName}/${it.name}`;
      });

      external.push("bun");
      external.push("bun:sqlite");

      if (flags.external) {
        const entries = flags.external
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const entry of entries) {
          external.push(entry);
          // If the entry is a bare package name, also externalize all its
          // sub-paths by reading its package.json exports.
          if (!entry.includes("/") || entry.startsWith("@")) {
            const [scope, name] = entry.startsWith("@")
              ? entry.split("/")
              : [null, entry];
            if (scope && !name) continue;
            try {
              const require = createRequire(this.fs.join(root, "package.json"));
              const pkgJsonPath = require.resolve(`${entry}/package.json`);
              const pkgBuf = await this.fs.readFile(pkgJsonPath);
              const pkg = JSON.parse(pkgBuf.toString("utf-8"));
              for (const exp of Object.keys(pkg.exports ?? {})) {
                if (exp === "." || exp.endsWith(".json")) continue;
                external.push(`${entry}${exp.slice(1)}`);
              }
            } catch {
              // ignore if package not installed
            }
          }
        }
      }

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
            skipNodeModulesBundle: true,
          },
          dts: {
            sourcemap: true,
          },
        });

        const deps = {
          neverBundle: external,
          skipNodeModulesBundle: true,
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
          `export default ${JSON.stringify(entries, null, 2)};`,
        );

        // /!\ Warning /!\
        // avoid to call tsdown programmatically, when we spawn 8 processes at once it 'JavaScript heap out of memory' :---)
        await run(`npx tsdown -c=${config}`);
      };

      const concurrency = Math.ceil(os.cpus().length / 2);
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
