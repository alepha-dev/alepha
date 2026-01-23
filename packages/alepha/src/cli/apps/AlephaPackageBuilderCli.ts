import { access, readdir, readFile } from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { $inject, AlephaError } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import type { InlineConfig } from "tsdown";

interface Module {
  name: string;
  dependencies: string[];
  native?: boolean;
  browser?: boolean;
  bun?: boolean;
  node?: boolean;
}

export class AlephaPackageBuilderCli {
  src = "src";
  dist = "dist";
  fs = $inject(FileSystemProvider);

  make = $command({
    root: true,
    handler: async ({ run, root }) => {
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

      if (packageName === "@alepha/ui") {
        pkgData.exports["./styles"] = "./src/core/styles.css";
        pkgData.exports["./json/styles"] = "./src/json/styles.css";
      }

      await this.fs.writeFile("package.json", JSON.stringify(pkgData, null, 2));

      const tmpDir = this.fs.join(root, "node_modules/.alepha");
      await this.fs.mkdir(tmpDir, { recursive: true }).catch(() => {});

      await this.fs.writeFile(
        this.fs.join(tmpDir, "module-dependencies.json"),
        JSON.stringify(modules, null, 2),
      );

      const tsconfigBuffer = await this.fs.readFile(
        this.fs.join(root, "../../tsconfig.json"),
      );

      const external: string[] = Object.keys(
        JSON.parse(tsconfigBuffer.toString("utf-8")).compilerOptions.paths,
      );

      external.push("bun");
      external.push("bun:sqlite");

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
          inlineOnly: false,
          external,
          dts: {
            sourcemap: true,
          },
        });

        if (item.native) {
          entries.push({
            entry: this.fs.join(src, "index.native.ts"),
            outDir: dest,
            platform: "neutral",
            sourcemap: true,
            dts: false,
            inlineOnly: false,
            external,
          });
        }

        if (item.browser) {
          entries.push({
            entry: this.fs.join(src, "index.browser.ts"),
            outDir: dest,
            platform: "browser",
            sourcemap: true,
            dts: false,
            inlineOnly: false,
            external,
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
            inlineOnly: false,
            external,
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

export default AlephaPackageBuilderCli;

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

  return cleaned;
}

function extractAlephaDependencies(
  content: string,
  packageName: string,
  moduleName: string,
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
      // Found a cycle, return the path
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

          // Get all .ts/.tsx files in this module
          const files = await getAllFiles(modulePath);

          for (const file of files) {
            const content = await readFile(file, "utf-8");
            const deps = extractAlephaDependencies(
              content,
              packageName,
              moduleName,
            );
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
