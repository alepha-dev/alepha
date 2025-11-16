import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import type { InlineConfig } from "tsdown";

interface Module {
  name: string;
  dependencies: string[];
  browser?: boolean;
  node?: boolean;
}

export class PackageBuilderCli {
  src = "src";
  dist = "dist";
  fs = $inject(FileSystemProvider);

  make = $command({
    root: true,
    handler: async ({ run, root }) => {
      const modules: Array<Module> = [];

      await run("analyze modules", async () => {
        modules.push(...(await analyzeModules(join(root, this.src))));
      });

      const pkg = await readFile("package.json", "utf-8");
      const pkgData = JSON.parse(pkg);
      pkgData.exports = {};
      for (const item of modules) {
        const path =
          item.name === "core" ? "." : `./${item.name.replace("-", "/")}`;
        pkgData.exports[path] = {
          types: `./src/${item.name}/index.ts`,
          require: `./src/${item.name}/index.ts`,
          import: `./src/${item.name}/index.ts`,
        };
        if (item.browser) {
          pkgData.exports[path].browser = `./src/${item.name}/index.browser.ts`;
        }
      }
      await this.fs.writeFile("package.json", JSON.stringify(pkgData, null, 2));

      const tmpDir = join(root, "node_modules/.alepha");
      await this.fs.mkdir(tmpDir, { recursive: true }).catch(() => {});

      await this.fs.writeFile(
        join(tmpDir, "module-dependencies.json"),
        JSON.stringify(modules, null, 2),
      );

      const external = modules.map((item) => `alepha/${item.name}`);

      await run.rm(this.dist);

      for (const item of modules) {
        const entries: InlineConfig[] = [];
        const src = join(root, this.src, item.name);
        const dest = join(root, this.dist, item.name);

        entries.push({
          entry: join(src, "index.ts"),
          outDir: dest,
          format: ["esm", "cjs"],
          sourcemap: true,
          fixedExtension: false,
          platform: "node", // TODO: node must be enabled only if index.node.ts exists
          external,
        });

        if (item.browser) {
          entries.push({
            entry: join(src, "index.browser.ts"),
            outDir: dest,
            platform: "browser",
            sourcemap: true,
            dts: false,
            external,
          });
        }

        const config = join(tmpDir, `tsdown-${item.name}.config.js`);
        await this.fs.writeFile(
          config,
          `export default ${JSON.stringify(entries, null, 2)};`,
        );
        await run(`npx tsdown -c=${config}`);
        await this.fs.rm(config);
      }
    },
  });
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

  return cleaned;
}

function extractAlephaDependencies(content: string): string[] {
  const deps = new Set<string>();
  const cleanedContent = removeComments(content);

  // Match: from "alepha/xxx" or from 'alepha/xxx'
  const importRegex = /from\s+['"]alepha\/([^'"]+)['"]/g;

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
      throw new Error(`Circular dependency detected: ${cycle.join(" -> ")}`);
    }
  }
}

function topologicalSort(modules: Module[]): Module[] {
  const moduleMap = new Map(modules.map((m) => [m.name, m]));
  const visited = new Set<string>();
  const sorted: Module[] = [];

  function visit(moduleName: string) {
    if (visited.has(moduleName)) return;

    visited.add(moduleName);

    const module = moduleMap.get(moduleName);
    if (!module) return;

    // Visit dependencies first
    for (const dep of module.dependencies) {
      visit(dep);
    }

    sorted.push(module);
  }

  for (const module of modules) {
    visit(module.name);
  }

  return sorted;
}

export async function analyzeModules(srcDir: string): Promise<Module[]> {
  const modules: Module[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const moduleName = entry.name;
      const modulePath = join(srcDir, moduleName);
      const dependencies = new Set<string>();

      // Check for browser/node entry points
      const hasBrowser = await fileExists(join(modulePath, "index.browser.ts"));
      const hasNode = await fileExists(join(modulePath, "index.node.ts"));

      // Get all .ts/.tsx files in this module
      const files = await getAllFiles(modulePath);

      for (const file of files) {
        const content = await readFile(file, "utf-8");
        const deps = extractAlephaDependencies(content);
        for (const dep of deps) {
          const normalizedModuleName = moduleName.replace("-", "/");
          //if (dep.startsWith(normalizedModuleName)) continue;
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

      if (hasBrowser) module.browser = true;
      if (hasNode) module.node = true;

      modules.push(module);
    }
  }

  // Check for circular dependencies
  detectCircularDependencies(modules);

  // Sort topologically (dependencies first)
  return topologicalSort(modules);
}
