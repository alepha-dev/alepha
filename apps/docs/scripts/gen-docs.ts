import { type Dirent, promises as fs } from "node:fs";
import { join, relative } from "node:path";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type { EnvVarInfo, ModuleInfo } from "./interfaces.ts";

interface PrimitiveDoc {
  name: string;
  summary: string;
  description: string;
  examples: string[];
  importPath: string;
  options: OptionField[];
  kind: "primitive" | "hook";
}

interface OptionField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ProviderDoc {
  name: string;
  summary: string;
  description: string;
  importPath: string;
}

interface ModuleData {
  description: string | null;
  primitives: PrimitiveDoc[];
  hooks: PrimitiveDoc[];
  providers: ProviderDoc[];
  envVars: EnvVarInfo[];
}

/**
 * Generates per-reference documentation pages (docs/2-reference/)
 * and per-package documentation pages + READMEs (docs/3-packages/).
 */
export class DocsCommand {
  protected log = $logger();

  /**
   * Parse a JSDoc block into description and @example sections.
   */
  parseJsDoc(jsDocBlock: string): { description: string; examples: string[] } {
    const lines = jsDocBlock
      .split("\n")
      .map((line) => line.replace(/^ \* ?/, ""));

    const descLines: string[] = [];
    const examples: string[] = [];
    let inExample = false;
    let currentExample: string[] = [];

    for (const line of lines) {
      if (line.startsWith("@example")) {
        if (inExample && currentExample.length > 0) {
          examples.push(currentExample.join("\n").trim());
          currentExample = [];
        }
        inExample = true;
        const rest = line.replace(/^@example\s*/, "").trim();
        if (rest) currentExample.push(rest);
        continue;
      }

      if (line.startsWith("@")) {
        if (inExample && currentExample.length > 0) {
          examples.push(currentExample.join("\n").trim());
          currentExample = [];
        }
        inExample = false;
        continue;
      }

      if (inExample) currentExample.push(line);
      else descLines.push(line);
    }

    if (inExample && currentExample.length > 0) {
      examples.push(currentExample.join("\n").trim());
    }

    return { description: descLines.join("\n").trim(), examples };
  }

  formatPackageName(name: string): string {
    return name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  escapeTableCell(str: string): string {
    return str
      .replace(/\|/g, "\\|")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  buildImportPathMap(pkgJson: any): Map<string, string> {
    const map = new Map<string, string>();
    const exports = pkgJson.exports;
    if (!exports || typeof exports !== "object") return map;

    for (const [key, value] of Object.entries(exports)) {
      if (key === "./tsconfig" || key === "./package.json") continue;
      const v = value as any;
      const typesPath = typeof v === "string" ? v : v.types || v.import;
      if (!typesPath?.startsWith("./src/")) continue;

      const sourceDir = typesPath
        .replace("./", "")
        .split("/")
        .slice(0, -1)
        .join("/");
      const importPath =
        key === "." ? pkgJson.name : `${pkgJson.name}/${key.replace("./", "")}`;
      map.set(sourceDir, importPath);
    }

    return map;
  }

  resolveImportPath(
    filePath: string,
    srcDir: string,
    importMap: Map<string, string>,
  ): string {
    const parts = relative(srcDir, filePath).split("/");
    for (let i = parts.length - 1; i >= 0; i--) {
      const hit = importMap.get(`src/${parts.slice(0, i).join("/")}`);
      if (hit) return hit;
    }
    return importMap.get("src/core") ?? "alepha";
  }

  findInterfaceBody(content: string, typeName: string): string | null {
    const m = content.match(
      new RegExp(`export (?:interface|type) ${typeName}[\\s\\S]*?\\{`),
    );
    if (!m || m.index === undefined) return null;

    let depth = 1;
    let i = m.index + m[0].length;
    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth++;
      if (content[i] === "}") depth--;
      i++;
    }
    return content.slice(m.index + m[0].length, i - 1);
  }

  parseInterfaceFields(body: string): OptionField[] {
    const fields: OptionField[] = [];
    let jsDocLines: string[] = [];
    let inJsDoc = false;

    for (const line of body.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.startsWith("/**")) {
        inJsDoc = true;
        jsDocLines = [];
        if (trimmed.endsWith("*/")) {
          inJsDoc = false;
          const c = trimmed.slice(3, -2).trim();
          if (c) jsDocLines.push(c);
        }
        continue;
      }

      if (inJsDoc) {
        if (trimmed.endsWith("*/") || trimmed === "*/") {
          inJsDoc = false;
          const c = trimmed
            .replace(/\*\/.*$/, "")
            .replace(/^\* ?/, "")
            .trim();
          if (c) jsDocLines.push(c);
        } else {
          const c = trimmed.replace(/^\* ?/, "");
          if (c && !/^@(example|param|see|default)/.test(c)) jsDocLines.push(c);
        }
        continue;
      }

      const fm = trimmed.match(/^(\w+)(\??)\s*:\s*(.+)/);
      if (fm && !trimmed.startsWith("//")) {
        let typeStr = fm[3].replace(/[;,]\s*$/, "").trim();
        if (typeStr.startsWith("{") || typeStr.startsWith("("))
          typeStr = "Object";
        if (typeStr.length > 60) typeStr = `${typeStr.slice(0, 57)}...`;

        fields.push({
          name: fm[1],
          type: typeStr,
          required: fm[2] !== "?",
          description: jsDocLines
            .filter((l) => !l.startsWith("@"))
            .join(" ")
            .split(". ")[0]
            .trim(),
        });
        jsDocLines = [];
      }
    }
    return fields;
  }

  extractOptions(content: string, primitiveName: string): OptionField[] {
    const escaped = primitiveName.replace("$", "\\$");
    const m = content.match(
      new RegExp(
        `export (?:const|function) ${escaped}[\\s\\S]*?\\([\\s\\S]*?options\\??:\\s*(\\w+)`,
      ),
    );
    if (!m) return [];
    const body = this.findInterfaceBody(content, m[1]);
    return body ? this.parseInterfaceFields(body) : [];
  }

  async extractPrimitiveDoc(
    filePath: string,
    srcDir: string,
    importMap: Map<string, string>,
    isHook: boolean,
  ): Promise<PrimitiveDoc | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const pattern = isHook
        ? /\/\*\*\s*\n((?:(?!\/\*\*)[\s\S])*?)\s*\*\/\s*\nexport (?:const|function) (use\w+)/
        : /\/\*\*\s*\n((?:(?!\/\*\*)[\s\S])*?)\s*\*\/\s*\nexport (?:const|function) (\$\w+)/;

      const match = content.match(pattern);
      if (!match || match[1].includes("@internal")) return null;

      const { description, examples } = this.parseJsDoc(match[1]);
      return {
        name: match[2],
        summary:
          description
            .split("\n")
            .find((l) => l.trim())
            ?.trim() ?? "",
        description,
        examples,
        importPath: this.resolveImportPath(filePath, srcDir, importMap),
        options: isHook ? [] : this.extractOptions(content, match[2]),
        kind: isHook ? "hook" : "primitive",
      };
    } catch (error) {
      this.log.error(`Error extracting from ${filePath}:`, error);
      return null;
    }
  }

  async extractProviderInfo(
    filePath: string,
    srcDir: string,
    importMap: Map<string, string>,
  ): Promise<ProviderDoc | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const regex =
        /\/\*\*\s*\n((?:(?!\/\*\*)[\s\S])*?)\s*\*\/\s+export class (\w+)/g;
      const fileName =
        filePath
          .split("/")
          .pop()
          ?.replace(/\.tsx?$/, "") ?? "";

      const providers: ProviderDoc[] = [];
      for (const m of content.matchAll(regex)) {
        if (m[1].includes("@internal")) continue;
        const { description } = this.parseJsDoc(m[1]);
        providers.push({
          name: m[2],
          summary:
            description
              .split("\n")
              .find((l) => l.trim())
              ?.trim() ?? "",
          description,
          importPath: this.resolveImportPath(filePath, srcDir, importMap),
        });
      }

      if (providers.length === 0) return null;
      return providers.find((p) => p.name === fileName) ?? providers[0];
    } catch (error) {
      this.log.error(`Error parsing provider file ${filePath}:`, error);
      return null;
    }
  }

  async extractEnvInfo(filePath: string): Promise<EnvVarInfo[]> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (!content.includes("$env(")) return [];

      const schemaMatch = content.match(
        /const\s+envSchema\s*=\s*t\.object\(\{([\s\S]*?)\}\);/,
      );
      if (!schemaMatch) return [];

      const schema = schemaMatch[1];
      const envVars: EnvVarInfo[] = [];

      for (const name of Array.from(schema.matchAll(/([A-Z][A-Z0-9_]+):/g)).map(
        (m) => m[1],
      )) {
        const start = schema.indexOf(`${name}:`);
        if (start === -1) continue;
        const next = schema
          .slice(start + name.length)
          .match(/[A-Z][A-Z0-9_]+:/);
        const field = schema.slice(
          start,
          next ? start + name.length + (next.index ?? 0) : undefined,
        );

        const isOptional = field.includes("t.optional(");
        const typeMatch = isOptional
          ? field.match(/t\.optional\(\s*t\.(\w+)/)
          : field.match(/:\s*t\.(\w+)/);
        if (!typeMatch) continue;

        const descMatch = field.match(/description:\s*["']([^"']+)["']/);
        const defaultMatch = field.match(/default:\s*([^,\n}]+)/);
        let defaultValue = defaultMatch?.[1]?.trim();
        if (defaultValue)
          defaultValue = defaultValue.replace(/^["']|["']$/g, "");

        envVars.push({
          name,
          type: typeMatch[1],
          description: descMatch?.[1],
          default: defaultValue,
          optional: isOptional || defaultValue !== undefined,
        });
      }
      return envVars;
    } catch (error) {
      this.log.error(`Error extracting env info from ${filePath}:`, error);
      return [];
    }
  }

  async extractModuleDescription(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      for (const m of content.matchAll(/\/\*\*\s*\n([\s\S]*?)\s*\*\//g)) {
        if (m[1].includes("@module")) return this.parseJsDoc(m[1]).description;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Read .ts files from a subdirectory, filter, and extract with a callback.
   */
  async readDir<T>(
    dir: string,
    filter: (name: string) => boolean,
    extract: (path: string) => Promise<T | null>,
  ): Promise<T[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const results = await Promise.all(
        entries
          .filter((e) => e.isFile() && e.name.endsWith(".ts") && filter(e.name))
          .map((e) => extract(join(dir, e.name))),
      );
      return results.filter((r) => r !== null);
    } catch {
      return [];
    }
  }

  async getEnvInfo(packagePath: string): Promise<EnvVarInfo[]> {
    const seen = new Set<string>();
    const all: EnvVarInfo[] = [];

    const walk = async (dir: string) => {
      try {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith("__"))
            await walk(full);
          else if (
            entry.isFile() &&
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".spec.ts")
          ) {
            for (const e of await this.extractEnvInfo(full)) {
              if (!seen.has(e.name)) {
                seen.add(e.name);
                all.push(e);
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    };

    await walk(packagePath);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Collect all data for a module in one pass.
   */
  async collectModuleData(
    sourcePath: string,
    srcDir: string,
    importMap: Map<string, string>,
  ): Promise<ModuleData> {
    const notSpec = (n: string) =>
      !n.endsWith(".spec.ts") && !n.endsWith(".browser.ts");
    const [description, primitives, hooks, providers, envVars] =
      await Promise.all([
        // Try index.ts then Alepha.ts for @module description
        this.extractModuleDescription(join(sourcePath, "index.ts")).then(
          (r) =>
            r ?? this.extractModuleDescription(join(sourcePath, "Alepha.ts")),
        ),
        this.readDir(
          join(sourcePath, "primitives"),
          (n) => n.startsWith("$") && notSpec(n),
          (p) => this.extractPrimitiveDoc(p, srcDir, importMap, false),
        ),
        this.readDir(
          join(sourcePath, "hooks"),
          (n) => n.startsWith("use") && notSpec(n),
          (p) => this.extractPrimitiveDoc(p, srcDir, importMap, true),
        ),
        this.readDir(
          join(sourcePath, "providers"),
          (n) => notSpec(n),
          (p) => this.extractProviderInfo(p, srcDir, importMap),
        ),
        this.getEnvInfo(sourcePath),
      ]);

    return { description, primitives, hooks, providers, envVars };
  }

  extractModules(pkgJson: any, packagePath: string): ModuleInfo[] | null {
    const exports = pkgJson.exports;
    if (!exports || typeof exports !== "object") return null;

    const modules: ModuleInfo[] = [];
    for (const [key, value] of Object.entries(exports)) {
      if (key === "./tsconfig" || key === "./package.json") continue;
      const v = value as any;
      const typesPath = typeof v === "string" ? v : v.types || v.import;
      if (
        !typesPath?.startsWith("./src/") ||
        (!typesPath.endsWith(".ts") && !typesPath.endsWith(".tsx"))
      )
        continue;

      modules.push({
        name:
          key === "." ? "core" : key.replace(/^\.\//, "").replace(/\//g, "-"),
        exportKey: key,
        sourcePath: join(
          packagePath,
          typesPath.split("/").slice(0, -1).join("/"),
        ),
      });
    }

    return modules.length > 1 ? modules : null;
  }

  getPackageDirName(pkgName: string, allPackages: string[]): string {
    const safeName = pkgName.replace(/\//g, "-");
    const order: Record<string, number> = {
      alepha: 1,
      "@alepha/ui-registry": 2,
      "@alepha/ui": 3,
    };
    if (order[pkgName]) return `${order[pkgName]}-${safeName}`;
    const reservedCount = Object.keys(order).length;
    const others = allPackages.filter((p) => !order[p]).sort();
    return `${others.indexOf(pkgName) + reservedCount + 1}-${safeName}`;
  }

  getAlephaModuleFilePath(
    moduleName: string,
    subdirPrefixes: Set<string>,
  ): { subdir: string | null; filename: string } {
    if (moduleName === "core") return { subdir: null, filename: "core.md" };
    const idx = moduleName.indexOf("-");
    const prefix = idx === -1 ? moduleName : moduleName.substring(0, idx);
    if (!subdirPrefixes.has(prefix))
      return { subdir: null, filename: `${moduleName}.md` };
    if (idx === -1) return { subdir: prefix, filename: "core.md" };
    return { subdir: prefix, filename: `${moduleName.substring(idx + 1)}.md` };
  }

  generateReferenceMarkdown(doc: {
    name: string;
    description: string;
    importPath: string;
    options?: OptionField[];
    examples?: string[];
  }): string {
    let md = `# ${doc.name}\n\n`;
    md += `## Import\n\n\`\`\`typescript\nimport { ${doc.name} } from "${doc.importPath}";\n\`\`\`\n\n`;
    if (doc.description) md += `## Overview\n\n${doc.description}\n\n`;

    if (doc.options && doc.options.length > 0) {
      md += `## Options\n\n| Option | Type | Required | Description |\n|--------|------|----------|-------------|\n`;
      for (const o of doc.options) {
        md += `| \`${o.name}\` | \`${this.escapeTableCell(o.type)}\` | ${o.required ? "Yes" : "No"} | ${this.escapeTableCell(o.description)} |\n`;
      }
      md += `\n`;
    }

    if (doc.examples && doc.examples.length > 0) {
      md += `## Examples\n\n`;
      for (const ex of doc.examples) md += `${ex}\n\n`;
    }
    return md;
  }

  /**
   * Generate the API Reference section (primitives, hooks, providers, env vars).
   */
  generateApiReference(
    data: ModuleData,
    urls: { primitives: string; hooks: string; providers: string },
    envLabel: string,
  ): string {
    const hasContent =
      data.primitives.length +
        data.hooks.length +
        data.providers.length +
        data.envVars.length >
      0;
    if (!hasContent) return "";

    let out = `## API Reference\n`;

    if (data.primitives.length > 0) {
      out += `\n### Primitives\n\n`;
      for (const p of data.primitives) {
        out += `- [\`${p.name}\`](${urls.primitives}${p.name.toLowerCase()}) — ${p.summary}\n`;
      }
    }

    if (data.hooks.length > 0) {
      out += `\n### React Hooks\n\n`;
      for (const h of data.hooks) {
        out += `- [\`${h.name}\`](${urls.hooks}${h.name.toLowerCase()}) — ${h.summary}\n`;
      }
    }

    if (data.providers.length > 0) {
      out += `\n### Providers\n\n`;
      for (const p of data.providers) {
        out += `- [\`${p.name}\`](${urls.providers}${p.name.toLowerCase()}) — ${p.summary}\n`;
      }
    }

    if (data.envVars.length > 0) {
      out += `\n### Environment Variables\n\n${envLabel}\n`;
      out += `\n| Variable | Type | Default | Description |\n|----------|------|---------|-------------|\n`;
      for (const e of data.envVars) {
        const req = e.optional ? "" : "**Required**";
        out += `| \`${e.name}\` | ${e.type} | ${e.default ?? (e.optional ? "-" : req)} | ${e.description ?? ""} |\n`;
      }
    }

    return out;
  }

  generateModuleMarkdown(
    pkgJson: any,
    moduleName: string,
    packageName: string,
    data: ModuleData,
  ): string {
    const formatted = this.formatPackageName(moduleName);
    const prefix =
      packageName === "alepha"
        ? "Alepha"
        : `@alepha/${packageName.replace("@alepha/", "")}`;
    let md = `# ${prefix} - ${formatted}\n\n`;

    if (pkgJson.description && moduleName === "core")
      md += `${pkgJson.description}\n\n`;

    md += `## Installation\n\n`;
    if (packageName === "alepha") {
      const idx = moduleName.indexOf("-");
      const importPath =
        moduleName === "core"
          ? "alepha"
          : idx === -1
            ? `alepha/${moduleName}`
            : `alepha/${moduleName.substring(0, idx)}/${moduleName.substring(idx + 1)}`;
      md += `Part of the \`alepha\` package. Import from \`${importPath}\`.\n\n\`\`\`bash\nnpm install alepha\n\`\`\`\n\n`;
    } else {
      md += `\`\`\`bash\nnpm install ${pkgJson.name}\n\`\`\`\n\n`;
    }

    if (data.description) md += `## Overview\n\n${data.description}\n\n`;
    md += this.generateApiReference(
      data,
      {
        primitives: "/docs/reference-primitives-",
        hooks: "/docs/reference-react-hooks-",
        providers: "/docs/reference-providers-",
      },
      "Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.",
    );
    return md;
  }

  generatePackageReadme(
    pkgJson: any,
    packageName: string,
    data: ModuleData,
  ): string {
    let md = `# Alepha ${this.formatPackageName(packageName)}\n\n`;
    if (pkgJson.description) md += `${pkgJson.description}\n\n`;
    md += `## Installation\n\nThis package is part of the Alepha framework and can be installed via the all-in-one package:\n\n\`\`\`bash\nnpm install alepha\n\`\`\`\n\n`;
    if (data.description) md += `## Module\n\n${data.description}\n\n`;
    md += this.generateApiReference(
      data,
      {
        primitives: "https://alepha.dev/docs/reference-primitives-",
        hooks: "https://alepha.dev/docs/reference-react-hooks-",
        providers: "https://alepha.dev/docs/reference-providers-",
      },
      "Environment variables used to configure this package.",
    );
    return md;
  }

  docs = $command({
    name: "gen:docs",
    description: "Generate reference pages and package documentation",
    handler: async ({ run, root }) => {
      const rootDir = join(root, "../..");
      const packagesDir = join(rootDir, "packages");
      const referenceDocsDir = join(rootDir, "docs/2-reference");
      const primitivesDocsDir = join(referenceDocsDir, "1-primitives");
      const hooksDocsDir = join(referenceDocsDir, "2-react-hooks");
      const providersDocsDir = join(referenceDocsDir, "3-providers");
      const packagesDocsDir = join(rootDir, "docs/3-packages");

      await run("clean", async () => {
        await fs.rm(referenceDocsDir, { recursive: true, force: true });
        await fs.mkdir(primitivesDocsDir, { recursive: true });
        await fs.mkdir(hooksDocsDir, { recursive: true });
        await fs.mkdir(providersDocsDir, { recursive: true });
        await fs.rm(packagesDocsDir, { recursive: true, force: true });
        await fs.mkdir(packagesDocsDir, { recursive: true });
      });

      let dirents: Dirent[];
      try {
        dirents = await fs.readdir(packagesDir, { withFileTypes: true });
      } catch (error) {
        this.log.error(`Could not read packages directory at: ${packagesDir}`);
        throw error;
      }

      // Resolve package paths (handling @scope/ directories)
      const packagePaths: { name: string; path: string }[] = [];
      for (const d of dirents) {
        if (!d.isDirectory()) continue;
        if (d.name.startsWith("@")) {
          // Scoped directory — recurse one level
          const scopeDir = join(packagesDir, d.name);
          const scopeEntries = await fs.readdir(scopeDir, {
            withFileTypes: true,
          });
          for (const sd of scopeEntries) {
            if (sd.isDirectory()) {
              packagePaths.push({
                name: `${d.name}/${sd.name}`,
                path: join(scopeDir, sd.name),
              });
            }
          }
        } else {
          packagePaths.push({
            name: d.name,
            path: join(packagesDir, d.name),
          });
        }
      }

      // First pass: collect package names and alepha module structure
      const alephaModules: string[] = [];
      const allPackageNames: string[] = [];

      for (const entry of packagePaths) {
        try {
          const pkg = JSON.parse(
            await fs.readFile(join(entry.path, "package.json"), "utf-8"),
          );
          if (pkg.private) continue;
          allPackageNames.push(pkg.name);
          if (pkg.name === "alepha") {
            const mods = this.extractModules(pkg, entry.path);
            if (mods) alephaModules.push(...mods.map((m) => m.name));
          }
        } catch {
          /* skip */
        }
      }

      const prefixCounts = new Map<string, number>();
      for (const mod of alephaModules) {
        const p = mod.includes("-") ? mod.substring(0, mod.indexOf("-")) : mod;
        prefixCounts.set(p, (prefixCounts.get(p) || 0) + 1);
      }
      const subdirPrefixes = new Set(
        [...prefixCounts].filter(([, c]) => c > 1).map(([p]) => p),
      );

      // Second pass: collect data and generate
      const allPrimitiveDocs: PrimitiveDoc[] = [];
      const allHookDocs: PrimitiveDoc[] = [];
      const allProviderDocs: ProviderDoc[] = [];
      const stats = {
        primitives: 0,
        hooks: 0,
        providers: 0,
        packages: 0,
        readmes: 0,
      };

      for (const entry of packagePaths) {
        await run(`scan ${entry.name}`, async () => {
          const packagePath = entry.path;
          let pkgJson: any;
          try {
            pkgJson = JSON.parse(
              await fs.readFile(join(packagePath, "package.json"), "utf-8"),
            );
          } catch {
            return;
          }
          if (pkgJson.private) return;

          const realPkgName: string = pkgJson.name;
          const importMap = this.buildImportPathMap(pkgJson);
          const srcDir = join(packagePath, "src");
          const dirName = this.getPackageDirName(realPkgName, allPackageNames);
          const pkgDocsDir = join(packagesDocsDir, dirName);
          const modules = this.extractModules(pkgJson, packagePath);

          if (modules) {
            await fs.mkdir(pkgDocsDir, { recursive: true });
            for (const mod of modules) {
              const data = await this.collectModuleData(
                mod.sourcePath,
                srcDir,
                importMap,
              );
              if (!data.description) continue;

              allPrimitiveDocs.push(...data.primitives);
              allHookDocs.push(...data.hooks);
              allProviderDocs.push(...data.providers);
              const md = this.generateModuleMarkdown(
                pkgJson,
                mod.name,
                realPkgName,
                data,
              );

              const { subdir, filename } =
                realPkgName === "alepha"
                  ? this.getAlephaModuleFilePath(mod.name, subdirPrefixes)
                  : { subdir: null, filename: `${mod.name}.md` };

              const targetDir = subdir ? join(pkgDocsDir, subdir) : pkgDocsDir;
              await fs.mkdir(targetDir, { recursive: true });
              await fs.writeFile(join(targetDir, filename), md, "utf-8");
              stats.packages++;
            }
          } else {
            const data = await this.collectModuleData(
              srcDir,
              srcDir,
              importMap,
            );
            if (!data.description) return;
            allPrimitiveDocs.push(...data.primitives);
            allHookDocs.push(...data.hooks);
            allProviderDocs.push(...data.providers);
            await fs.writeFile(
              join(packagesDocsDir, `${dirName}.md`),
              this.generateModuleMarkdown(
                pkgJson,
                entry.name,
                realPkgName,
                data,
              ),
              "utf-8",
            );
            stats.packages++;
          }

          // README
          if (realPkgName === "alepha") {
            await fs.copyFile(
              join(rootDir, "README.md"),
              join(packagePath, "README.md"),
            );
          } else {
            const data = await this.collectModuleData(
              srcDir,
              srcDir,
              importMap,
            );
            await fs.writeFile(
              join(packagePath, "README.md"),
              this.generatePackageReadme(pkgJson, realPkgName, data),
              "utf-8",
            );
          }
          stats.readmes++;
        });
      }

      await run("generate reference", async () => {
        allPrimitiveDocs.sort((a, b) => a.name.localeCompare(b.name));
        for (const doc of allPrimitiveDocs) {
          await fs.writeFile(
            join(primitivesDocsDir, `${doc.name}.md`),
            this.generateReferenceMarkdown(doc),
            "utf-8",
          );
        }
        stats.primitives = allPrimitiveDocs.length;

        allHookDocs.sort((a, b) => a.name.localeCompare(b.name));
        for (const doc of allHookDocs) {
          await fs.writeFile(
            join(hooksDocsDir, `${doc.name}.md`),
            this.generateReferenceMarkdown(doc),
            "utf-8",
          );
        }
        stats.hooks = allHookDocs.length;

        allProviderDocs.sort((a, b) => a.name.localeCompare(b.name));
        for (const doc of allProviderDocs) {
          await fs.writeFile(
            join(providersDocsDir, `${doc.name}.md`),
            this.generateReferenceMarkdown(doc),
            "utf-8",
          );
        }
        stats.providers = allProviderDocs.length;
      });

      this.log.debug(
        `Done: ${stats.primitives} primitives, ${stats.hooks} hooks, ${stats.providers} providers, ${stats.packages} package docs, ${stats.readmes} READMEs`,
      );
    },
  });
}
