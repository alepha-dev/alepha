import { type Dirent, promises as fs } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path, { join } from "node:path";
import { $inject, run } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import hljs from "highlight.js";
import { Marked, type Tokens } from "marked";
import { snippets } from "./snippets.ts";

export type DocItem = {
  slug: string;
  name: string;
  description: string;
  content: string;
  originalContent: string;
  originalName: string;
  path: string;
  category: string;
  order: number;
  level: number;
  readingTime: number;
  lastModified: string | null;
  keywords: string[];
};

export type DocNode = {
  slug: string;
  name: string;
  order: number;
  children?: DocNode[];
  href?: string;
  description?: string;
  asset?: string; // file extension for assets (e.g., "txt"), uses window.location instead of router
  keywords?: string[];
};

interface PrimitiveInfo {
  name: string;
  description: string;
}

interface ModuleInfo {
  name: string; // "core", "server-swagger", "api-files", etc.
  exportKey: string; // ".", "./server/swagger", "./api/files", etc.
  sourcePath: string; // Path to the module's source directory
}

/**
 * CLI for generating documentation
 */
class DocsCliApp {
  log = $logger();
  cli = $inject(CliProvider);

  /**
   * Called when no command is provided - shows help
   */
  root = $command({
    root: true,
    handler: async () => {
      this.cli.printHelp();
    },
  });

  /**
   * A simple utility function to format a package name like 'bucket-azure'
   * into a more readable 'Bucket Azure'.
   */
  formatPackageName(name: string): string {
    this.log.trace(`Formatting package name: ${name}`);
    const formatted = name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    this.log.trace(`Formatted result: ${formatted}`);
    return formatted;
  }

  /**
   * Cleans a raw JSDoc block into a readable string.
   * @param jsDocBlock - The raw string content from inside /** ... * /.
   * @returns A clean, single-line description.
   */
  cleanJsDoc(jsDocBlock: string): string {
    this.log.trace("Cleaning JSDoc block");
    const cleaned = jsDocBlock
      .split("\n")
      .map((line) => line.replace(/ \* ?/, ""))
      .filter((line) => !line.startsWith("@")) // Ignore tags like @param or @see
      .join("\n")
      .trim();
    this.log.trace(`Cleaned JSDoc (${cleaned.length} chars)`);
    return cleaned;
  }

  /**
   * Reads the `src/index.ts` file of a package and extracts the JSDoc comment
   * that contains "@module".
   * @param filePath - The full path to the index.ts file.
   * @returns The extracted description string, or null if not found or no @module tag.
   */
  async extractModuleDescription(filePath: string): Promise<string | null> {
    this.log.debug(`Extracting module description from: ${filePath}`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      this.log.trace(`Read ${content.length} chars from ${filePath}`);

      // Regex to find all JSDoc blocks in the file.
      const regex = /\/\*\*\s*\n([\s\S]*?)\s*\*\//g;
      const matches = Array.from(content.matchAll(regex));
      this.log.trace(`Found ${matches.length} JSDoc blocks`);

      // Search through all JSDoc comments to find one with "@module"
      for (const match of matches) {
        if (match[1].includes("@module")) {
          const description = this.cleanJsDoc(match[1]);
          this.log.debug(
            `Found @module description: ${description.slice(0, 50)}...`,
          );
          return description;
        }
      }

      this.log.trace("No @module tag found in JSDoc blocks");
      return null;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        this.log.trace(`File not found: ${filePath}`);
        return null;
      }
      this.log.error(
        `Error parsing module description from ${filePath}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Reads a primitive file and extracts the JSDoc comment block
   * for the main exported primitive function.
   */
  async extractPrimitiveInfo(
    filePath: string,
    hook = false,
  ): Promise<PrimitiveInfo | null> {
    this.log.debug(
      `Extracting ${hook ? "hook" : "primitive"} info from: ${filePath}`,
    );
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const regex = hook
        ? /\/\*\*\s*\n([\s\S]*?)\s*\*\/\s*\nexport const (use\w+)/
        : /\/\*\*\s*\n([\s\S]*?)\s*\*\/\s*\nexport const (\$\w+)/;

      const matches = Array.from(
        content.matchAll(new RegExp(regex.source, "g")),
      );
      this.log.trace(
        `Found ${matches.length} potential ${hook ? "hooks" : "primitives"}`,
      );

      for (const match of matches) {
        if (match[1].includes("@internal")) {
          this.log.trace(
            `Skipping @internal ${hook ? "hook" : "primitive"}: ${match[2]}`,
          );
          continue;
        }

        const info = {
          name: match[2],
          description: this.cleanJsDoc(match[1]),
        };
        this.log.debug(
          `Extracted ${hook ? "hook" : "primitive"}: ${info.name}`,
        );
        return info;
      }

      this.log.trace(`No ${hook ? "hooks" : "primitives"} found`);
      return null;
    } catch (error) {
      this.log.error(`Error parsing primitive file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Reads a provider file and extracts the JSDoc comment block
   * for the main exported provider function.
   */
  async extractProviderInfo(filePath: string): Promise<PrimitiveInfo | null> {
    this.log.debug(`Extracting provider info from: ${filePath}`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const regex = /\/\*\*\s*\n([\s\S]*?)\s*\*\/\s*\nexport class (\w+)/;

      const matches = Array.from(
        content.matchAll(new RegExp(regex.source, "g")),
      );
      this.log.trace(`Found ${matches.length} potential providers`);

      for (const match of matches) {
        if (match[1].includes("@internal")) {
          this.log.trace(`Skipping @internal provider: ${match[2]}`);
          continue;
        }

        const info = {
          name: match[2],
          description: this.cleanJsDoc(match[1]),
        };
        this.log.debug(`Extracted provider: ${info.name}`);
        return info;
      }

      this.log.trace("No providers found");
      return null;
    } catch (error) {
      this.log.error(`Error parsing provider file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Gets the last modified date of a file from git history.
   */
  async getGitLastModified(filePath: string): Promise<string | null> {
    this.log.trace(`Getting git last modified for: ${filePath}`);
    try {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(
        `git log -1 --format="%aI" -- "${filePath}"`,
        { cwd: join(import.meta.dirname, "../../..") },
      );

      const date = stdout.trim();
      if (date) {
        this.log.trace(`Last modified: ${date}`);
        return date;
      }
      return null;
    } catch (error) {
      this.log.trace(`Failed to get git last modified: ${error}`);
      return null;
    }
  }

  /**
   * Calculates reading time in minutes based on word count.
   * Average reading speed: 200 words per minute.
   */
  calculateReadingTime(content: string): number {
    const text = content.replace(/<[^>]*>/g, "").replace(/```[\s\S]*?```/g, "");
    const words = text.split(/\s+/).filter((word) => word.length > 0).length;
    const minutes = Math.ceil(words / 200);
    this.log.trace(`Reading time: ${minutes} min (${words} words)`);
    return Math.max(1, minutes);
  }

  /**
   * Extracts keywords from markdown content by parsing headings (h2, h3, h4).
   * Extracts meaningful terms like function names ($atom, $env), class names, etc.
   */
  extractKeywords(content: string): string[] {
    const keywords: Set<string> = new Set();

    // Match markdown headings: ## heading, ### heading, #### heading
    const headingRegex = /^#{2,4}\s+(.+)$/gm;
    const matches = content.matchAll(headingRegex);

    for (const match of matches) {
      const heading = match[1].trim();

      // Extract the raw heading text
      keywords.add(heading);

      // Extract code/function names from backticks: `$atom()` -> $atom
      const codeMatches = heading.matchAll(/`([^`]+)`/g);
      for (const codeMatch of codeMatches) {
        const code = codeMatch[1].replace(/[()]/g, "").trim();
        if (code) {
          keywords.add(code);
        }
      }

      // Extract individual words that look like identifiers (camelCase, PascalCase, $prefixed)
      const words = heading.replace(/`[^`]+`/g, "").split(/\s+/);
      for (const word of words) {
        const cleaned = word.replace(/[():`]/g, "").trim();
        // Include if it looks like an identifier: starts with $, or has mixed case, or is a common term
        if (
          cleaned.startsWith("$") ||
          cleaned.startsWith("use") ||
          /^[A-Z][a-z]/.test(cleaned) ||
          /[a-z][A-Z]/.test(cleaned)
        ) {
          keywords.add(cleaned);
        }
      }
    }

    const result = Array.from(keywords).filter((k) => k.length > 1);
    this.log.trace(`Extracted ${result.length} keywords`);
    return result;
  }

  /**
   * Finds all primitives in a package's `src/primitives` directory.
   */
  async getPrimitivesInfo(
    packagePath: string,
    dirName = "primitives",
  ): Promise<PrimitiveInfo[]> {
    const primitivesDir = join(packagePath, dirName);
    this.log.debug(`Getting ${dirName} info from: ${primitivesDir}`);
    try {
      const files = await fs.readdir(primitivesDir, { withFileTypes: true });
      const tsFiles = files.filter(
        (file) => file.isFile() && file.name.endsWith(".ts"),
      );
      this.log.trace(
        `Found ${tsFiles.length} .ts files in ${dirName} directory`,
      );

      const primitivePromises = tsFiles.map((file) =>
        this.extractPrimitiveInfo(
          join(primitivesDir, file.name),
          dirName === "hooks",
        ),
      );

      const results = await Promise.all(primitivePromises);
      const filtered = results.filter(
        (info): info is PrimitiveInfo => info !== null,
      );
      this.log.debug(
        `Extracted ${filtered.length} ${dirName} from ${primitivesDir}`,
      );
      return filtered;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        this.log.trace(`${dirName} directory not found: ${primitivesDir}`);
        return [];
      }
      throw error;
    }
  }

  /**
   * Finds all providers in a package's `src/providers` directory.
   */
  async getProvidersInfo(packagePath: string): Promise<PrimitiveInfo[]> {
    const providersDir = join(packagePath, "providers");
    this.log.debug(`Getting providers info from: ${providersDir}`);
    try {
      const files = await fs.readdir(providersDir, { withFileTypes: true });
      const tsFiles = files.filter(
        (file) => file.isFile() && file.name.endsWith(".ts"),
      );
      this.log.trace(
        `Found ${tsFiles.length} .ts files in providers directory`,
      );

      const providerPromises = tsFiles.map((file) =>
        this.extractProviderInfo(join(providersDir, file.name)),
      );

      const results = await Promise.all(providerPromises);
      const filtered = results.filter(
        (info): info is PrimitiveInfo => info !== null,
      );
      this.log.debug(
        `Extracted ${filtered.length} providers from ${providersDir}`,
      );
      return filtered;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        this.log.trace(`Providers directory not found: ${providersDir}`);
        return [];
      }
      throw error;
    }
  }

  /**
   * Extracts module information from package.json exports field.
   * Returns modules that should have documentation generated.
   */
  extractModules(pkgJson: any, packagePath: string): ModuleInfo[] | null {
    this.log.debug(`Extracting modules from package.json at: ${packagePath}`);
    const exports = pkgJson.exports;

    // No exports field - treat as single module
    if (!exports || typeof exports !== "object") {
      this.log.trace("No exports field found, treating as single module");
      return null;
    }

    const modules: ModuleInfo[] = [];

    for (const [key, value] of Object.entries(exports)) {
      // Skip tsconfig and package.json exports
      if (key === "./tsconfig" || key === "./package.json") {
        this.log.trace(`Skipping export: ${key}`);
        continue;
      }

      // Get the types or import path
      const exportValue = value as any;
      const typesPath =
        typeof exportValue === "string"
          ? exportValue
          : exportValue.types || exportValue.import;

      if (!typesPath || typeof typesPath !== "string") {
        this.log.trace(`No types path found for export: ${key}`);
        continue;
      }
      if (!typesPath.startsWith("./src/")) {
        this.log.trace(`Skipping non-src export: ${key} -> ${typesPath}`);
        continue;
      }

      // Extract module name from export key
      let moduleName: string;
      if (key === ".") {
        moduleName = "core";
      } else {
        // "./server/swagger" -> "server-swagger"
        // "./api/files" -> "api-files"
        // "./cache/redis" -> "cache-redis"
        moduleName = key.replace(/^\.\//, "").replace(/\//g, "-");
      }

      // Extract source directory from types path
      // "./src/server-swagger/index.ts" -> "src/server-swagger"
      const sourceDir = typesPath.split("/").slice(0, -1).join("/");
      const sourcePath = join(packagePath, sourceDir);

      this.log.trace(`Found module: ${moduleName} (${key}) -> ${sourcePath}`);
      modules.push({
        name: moduleName,
        exportKey: key,
        sourcePath,
      });
    }

    // If only one module or no modules, treat as single module
    const result = modules.length > 1 ? modules : null;
    this.log.debug(
      result
        ? `Extracted ${modules.length} modules`
        : "Only one module found, treating as single module",
    );
    return result;
  }

  /**
   * Generates markdown content for a module.
   * Returns null if the module doesn't have a @module tag (should be skipped).
   */
  async generateModuleMarkdown(
    pkgJson: any,
    moduleName: string,
    sourcePath: string,
    packageName: string,
  ): Promise<string | null> {
    this.log.debug(
      `Generating module markdown for: ${packageName}/${moduleName}`,
    );
    const formattedName = this.formatPackageName(moduleName);

    // Find the file with @module tag
    const candidates = [
      join(sourcePath, "index.ts"),
      join(sourcePath, `${moduleName}.ts`),
      join(sourcePath, "Alepha.ts"),
    ];

    this.log.trace(`Looking for @module tag in: ${sourcePath}`);
    let moduleDescription: string | null = null;
    let indexPath: string | null = null;

    for (const path of candidates) {
      try {
        await fs.access(path);
        this.log.trace(`Checking file: ${path}`);
        const description = await this.extractModuleDescription(path);
        if (description) {
          this.log.debug(`Found @module tag in: ${path}`);
          moduleDescription = description;
          indexPath = path;
          break;
        }
        this.log.trace(`No @module tag in: ${path}`);
      } catch {
        this.log.trace(`File not found: ${path}`);
      }
    }

    // Skip modules without @module tag
    if (!moduleDescription) {
      this.log.info(
        `Skipping module ${packageName}/${moduleName} - no @module tag found`,
      );
      return null;
    }

    const primitives = await this.getPrimitivesInfo(sourcePath);
    const hooks = await this.getPrimitivesInfo(sourcePath, "hooks");
    const providers = await this.getProvidersInfo(sourcePath);

    this.log.debug(
      `Found ${primitives.length} primitives, ${hooks.length} hooks, ${providers.length} providers`,
    );

    // Build the markdown content
    const pkgPrefix =
      packageName === "alepha"
        ? "Alepha"
        : `@alepha/${packageName.replace("@alepha/", "")}`;
    let content = `# ${pkgPrefix} - ${formattedName}\n\n`;

    if (pkgJson.description && moduleName === "core") {
      content += `${pkgJson.description}\n\n`;
    }

    content += `## Installation\n\n`;

    if (packageName === "alepha") {
      // Convert module name to import path: lock-redis → lock/redis, api-users → api/users
      let importPath: string;
      if (moduleName === "core") {
        importPath = "alepha";
      } else {
        const hyphenIndex = moduleName.indexOf("-");
        if (hyphenIndex === -1) {
          importPath = `alepha/${moduleName}`;
        } else {
          const prefix = moduleName.substring(0, hyphenIndex);
          const rest = moduleName.substring(hyphenIndex + 1);
          importPath = `alepha/${prefix}/${rest}`;
        }
      }
      content += `Part of the \`alepha\` package. Import from \`${importPath}\`.\n\n\`\`\`bash\nnpm install alepha\n\`\`\`\n\n`;
    } else {
      content += `\`\`\`bash\nnpm install ${pkgJson.name}\n\`\`\`\n\n`;
    }

    if (moduleDescription) {
      content += `## Overview\n\n${moduleDescription}\n\n`;
    }

    if (primitives.length > 0 || providers.length > 0 || hooks.length > 0) {
      content += `## API Reference\n`;
    }

    if (primitives.length > 0) {
      content += `\n### Primitives\n\nPrimitives are functions that define and configure various aspects of your application. They follow the convention of starting with \` $ \` and return configured primitive instances.\n\nFor more details, see the [Primitives documentation](/docs/concepts-primitives).\n`;
      for (const desc of primitives) {
        content += `\n#### ${desc.name}()\n\n${desc.description}\n`;
      }
    }

    if (hooks.length > 0) {
      content += `\n### Hooks\n\nHooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with \`use\` and return configured hook instances.\n`;
      for (const desc of hooks) {
        content += `\n#### ${desc.name}()\n\n${desc.description}\n`;
      }
    }

    if (providers.length > 0) {
      content += `\n### Providers\n\nProviders are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.\n\nFor more details, see the [Providers documentation](/docs/concepts-providers).\n`;
      for (const provider of providers) {
        content += `\n#### ${provider.name}\n\n${provider.description}\n`;
      }
    }

    this.log.trace(`Generated markdown (${content.length} chars)`);
    return content;
  }

  /**
   * Generates README.md content for a package.
   */
  async generatePackageReadme(
    pkgJson: any,
    packagePath: string,
    packageName: string,
  ): Promise<string> {
    this.log.debug(`Generating package README for: ${packageName}`);

    // Find the main index file
    const indexPath = await (async () => {
      const candidates = [
        join(packagePath, "src/index.ts"),
        join(packagePath, `src/${packageName}.ts`),
        join(packagePath, "src/Alepha.ts"),
      ];

      this.log.trace(`Looking for index file in: ${packagePath}/src`);
      for (const path of candidates) {
        try {
          await fs.access(path);
          this.log.debug(`Found index file: ${path}`);
          return path;
        } catch {
          this.log.trace(`Index file not found: ${path}`);
        }
      }
      this.log.debug("No index file found");
      return null;
    })();

    const moduleDescription = indexPath
      ? await this.extractModuleDescription(indexPath)
      : null;

    const primitives = await this.getPrimitivesInfo(join(packagePath, "src"));
    const hooks = await this.getPrimitivesInfo(
      join(packagePath, "src"),
      "hooks",
    );
    const providers = await this.getProvidersInfo(join(packagePath, "src"));

    this.log.debug(
      `Found ${primitives.length} primitives, ${hooks.length} hooks, ${providers.length} providers`,
    );

    // Build the README content
    const pkgTitle =
      packageName === "alepha"
        ? "Alepha"
        : `Alepha ${this.formatPackageName(packageName)}`;
    let content = `# ${pkgTitle}\n\n`;

    if (pkgJson.description) {
      content += `${pkgJson.description}\n\n`;
    }

    content += `## Installation\n\n`;

    content += `This package is part of the Alepha framework and can be installed via the all-in-one package:\n\n\`\`\`bash\nnpm install alepha\n\`\`\`\n\n`;

    if (moduleDescription) {
      content += `## Module\n\n${moduleDescription}\n\n`;
    }

    if (primitives.length > 0 || providers.length > 0 || hooks.length > 0) {
      content += `## API Reference\n`;
    }

    if (primitives.length > 0) {
      content += `\n### Primitives\n\nPrimitives are functions that define and configure various aspects of your application. They follow the convention of starting with \` $ \` and return configured primitive instances.\n\nFor more details, see the [Primitives documentation](https://feunard.github.io/alepha/).\n`;
      for (const desc of primitives) {
        content += `\n#### ${desc.name}()\n\n${desc.description}\n`;
      }
    }

    if (hooks.length > 0) {
      content += `\n### Hooks\n\nHooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with \`use\` and return configured hook instances.\n`;
      for (const desc of hooks) {
        content += `\n#### ${desc.name}()\n\n${desc.description}\n`;
      }
    }

    if (providers.length > 0) {
      content += `\n### Providers\n\nProviders are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.\n\nFor more details, see the [Providers documentation](https://feunard.github.io/alepha/).\n`;
      for (const provider of providers) {
        content += `\n#### ${provider.name}\n\n${provider.description}\n`;
      }
    }

    this.log.trace(`Generated README (${content.length} chars)`);
    return content;
  }

  marked = this.createMarked();

  /**
   * Converts npm commands to other package manager equivalents
   */
  convertToPackageManager(
    npmCommand: string,
    target: "npm" | "yarn" | "pnpm" | "bun",
  ): string {
    return npmCommand
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();

        // npx commands → yarn dlx / pnpm dlx / bunx
        if (trimmed.startsWith("npx ")) {
          const rest = trimmed.slice(4);
          switch (target) {
            case "npm":
              return `npx ${rest}`;
            case "yarn":
              return `yarn ${rest}`;
            case "pnpm":
              return `pnpm ${rest}`;
            case "bun":
              return `bunx ${rest}`;
          }
        }

        // npm install with packages
        const installMatch = trimmed.match(/^npm (install|i) (.+)$/);
        if (installMatch) {
          const packages = installMatch[2];
          switch (target) {
            case "npm":
              return `npm install ${packages}`;
            case "yarn":
              return `yarn add ${packages}`;
            case "pnpm":
              return `pnpm add ${packages}`;
            case "bun":
              return `bun add ${packages}`;
          }
        }

        // npm install without packages
        if (trimmed === "npm install" || trimmed === "npm i") {
          switch (target) {
            case "npm":
              return "npm install";
            case "yarn":
              return "yarn";
            case "pnpm":
              return "pnpm install";
            case "bun":
              return "bun install";
          }
        }

        // npm run <script> → yarn/pnpm/bun <script>
        const runMatch = trimmed.match(/^npm run (.+)$/);
        if (runMatch) {
          const script = runMatch[1];
          switch (target) {
            case "npm":
              return `npm run ${script}`;
            case "yarn":
              return `yarn ${script}`;
            case "pnpm":
              return `pnpm ${script}`;
            case "bun":
              return `bun run ${script}`;
          }
        }

        return line;
      })
      .join("\n");
  }

  /**
   * Checks if code is a package manager command
   */
  isPackageManagerCommand(code: string): boolean {
    const trimmed = code.trim();
    return /^(npm install|npm i |npm run |npx )/.test(trimmed);
  }

  /**
   * Renders a code block with package manager switcher
   */
  renderPackageManagerBlock(text: string): string {
    const managers = ["npm", "yarn", "pnpm", "bun"] as const;

    // Generate code variants
    const variants = Object.fromEntries(
      managers.map((pm) => [pm, this.convertToPackageManager(text, pm)]),
    );

    // Highlight each variant
    const highlighted = Object.fromEntries(
      managers.map((pm) => [
        pm,
        hljs.highlight(variants[pm], { language: "bash" }).value,
      ]),
    );

    // Encode as base64 for data attributes
    const base64 = Object.fromEntries(
      managers.map((pm) => [pm, Buffer.from(variants[pm]).toString("base64")]),
    );

    // Build data attributes for highlighted HTML
    const htmlAttrs = managers
      .map((pm) => `data-html-${pm}="${this.escapeHtml(highlighted[pm])}"`)
      .join(" ");

    // Build data attributes for copy (base64)
    const codeAttrs = managers
      .map((pm) => `data-code-${pm}="${base64[pm]}"`)
      .join(" ");

    return `
<div class="code-block code-block-pm">
  <div class="code-block-header">
    <div class="pm-tabs">
      ${managers.map((pm, i) => `<button type="button" class="pm-tab${i === 0 ? " pm-tab-active" : ""}" data-pm="${pm}" onclick="(function(btn){var block=btn.closest('.code-block-pm');block.querySelectorAll('.pm-tab').forEach(function(t){t.classList.remove('pm-tab-active')});btn.classList.add('pm-tab-active');var code=block.querySelector('code');code.innerHTML=code.getAttribute('data-html-'+btn.dataset.pm);var copy=block.querySelector('.code-block-copy');copy.setAttribute('data-code',copy.getAttribute('data-code-'+btn.dataset.pm))})(this)">${pm}</button>`).join("")}
    </div>
    <button class="code-block-copy" data-code="${base64.npm}" ${codeAttrs} onclick="(function(btn){var code=atob(btn.getAttribute('data-code'));navigator.clipboard.writeText(code);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},2000)})(this)">Copy</button>
  </div>
  <pre><code class="hljs language-bash" ${htmlAttrs} data-code="${base64.npm}">${highlighted.npm}</code></pre>
</div>`.trim();
  }

  /**
   * Escape HTML for use in data attributes
   */
  escapeHtml(html: string): string {
    return html
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Languages that should show line numbers
   */
  lineNumberLanguages = new Set([
    "typescript",
    "ts",
    "javascript",
    "js",
    "tsx",
    "jsx",
    "json",
    "css",
    "html",
    "yaml",
    "yml",
    "sql",
    "python",
    "py",
    "go",
    "rust",
    "java",
    "c",
    "cpp",
    "csharp",
    "php",
    "ruby",
    "swift",
    "kotlin",
  ]);

  /**
   * Parse code block meta info (e.g., ```ts {1,3-5} filename="example.ts")
   */
  parseCodeMeta(meta: string | null | undefined): {
    highlights: Set<number>;
    filename: string | null;
    showLineNumbers: boolean;
    collapsed: boolean;
  } {
    const result = {
      highlights: new Set<number>(),
      filename: null as string | null,
      showLineNumbers: true,
      collapsed: false,
    };

    if (!meta) return result;

    // Parse highlights: {1,3-5,10}
    const highlightMatch = meta.match(/\{([^}]+)\}/);
    if (highlightMatch) {
      const parts = highlightMatch[1].split(",");
      for (const part of parts) {
        if (part.includes("-")) {
          const [start, end] = part.split("-").map(Number);
          for (let i = start; i <= end; i++) {
            result.highlights.add(i);
          }
        } else {
          result.highlights.add(Number(part));
        }
      }
    }

    // Parse filename: filename="example.ts" or title="example.ts"
    const filenameMatch = meta.match(/(?:filename|title)=["']([^"']+)["']/);
    if (filenameMatch) {
      result.filename = filenameMatch[1];
    }

    // Parse showLineNumbers: showLineNumbers=false
    if (meta.includes("showLineNumbers=false") || meta.includes("nolines")) {
      result.showLineNumbers = false;
    }

    // Parse collapsed: collapsed or collapse
    if (meta.includes("collapsed") || meta.includes("collapse")) {
      result.collapsed = true;
    }

    return result;
  }

  /**
   * Render enhanced code block with line numbers and highlighting
   */
  renderEnhancedCodeBlock(
    text: string,
    lang: string,
    meta: string | null | undefined,
  ): string {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    const highlighted = hljs.highlight(text, { language }).value;
    const lines = highlighted.split("\n");
    const rawLines = text.split("\n");

    const { highlights, filename, showLineNumbers, collapsed } =
      this.parseCodeMeta(meta);

    // Determine if we should show line numbers
    const shouldShowLineNumbers =
      showLineNumbers && this.lineNumberLanguages.has(lang.toLowerCase());

    // Auto-collapse if more than 25 lines
    const isCollapsible = lines.length > 25 || collapsed;
    const isCollapsed = collapsed && lines.length > 15;

    // Encode raw code as base64
    const base64Code = Buffer.from(text).toString("base64");

    // Build header content
    const headerLeft = filename
      ? `<span class="code-block-filename">${filename}</span>`
      : `<span class="code-block-lang">${lang || "bash"}</span>`;

    const headerRight = `
      ${isCollapsible ? `<button class="code-block-expand" onclick="(function(btn){var block=btn.closest('.code-block');block.classList.toggle('collapsed');btn.textContent=block.classList.contains('collapsed')?'Expand':'Collapse'})(this)">${isCollapsed ? "Expand" : "Collapse"}</button>` : ""}
      <button class="code-block-copy" data-code="${base64Code}" onclick="(function(btn){var code=atob(btn.getAttribute('data-code'));navigator.clipboard.writeText(code);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},2000)})(this)">Copy</button>
    `.trim();

    // Build code lines
    let codeContent: string;
    if (shouldShowLineNumbers) {
      const lineNumberWidth = String(lines.length).length;
      codeContent = lines
        .map((line, i) => {
          const lineNum = i + 1;
          const isHighlighted = highlights.has(lineNum);
          const highlightClass = isHighlighted ? " code-line-highlighted" : "";
          const lineNumPadded = String(lineNum).padStart(lineNumberWidth, " ");
          return `<span class="code-line${highlightClass}"><span class="code-line-number">${lineNumPadded}</span><span class="code-line-content">${line || " "}</span></span>`;
        })
        .join("");
    } else {
      codeContent = highlighted;
    }

    const collapsedClass = isCollapsed ? " collapsed" : "";
    const lineNumClass = shouldShowLineNumbers ? " has-line-numbers" : "";

    return `
<div class="code-block code-block-enhanced${collapsedClass}${lineNumClass}">
  <div class="code-block-header">
    ${headerLeft}
    <div class="code-block-actions">${headerRight}</div>
  </div>
  <pre><code class="hljs language-${language}">${codeContent}</code></pre>
</div>`.trim();
  }

  /**
   * Converts a package name to a filesystem-safe directory name with ordering prefix.
   * alepha → 1-alepha
   * @alepha/react → 2-@alepha-react
   * @alepha/ui → 3-@alepha-ui
   * others → alphabetical order starting from 4
   */
  getPackageDirName(pkgName: string, allPackages: string[]): string {
    const safeName = pkgName.replace(/\//g, "-");

    // Define explicit ordering for core packages
    const coreOrder: Record<string, number> = {
      alepha: 1,
      "@alepha/react": 2,
      "@alepha/ui": 3,
    };

    if (coreOrder[pkgName]) {
      return `${coreOrder[pkgName]}-${safeName}`;
    }

    // For other packages, assign order based on alphabetical position starting from 4
    const otherPackages = allPackages.filter((p) => !coreOrder[p]).sort();
    const index = otherPackages.indexOf(pkgName);
    const order = index !== -1 ? 4 + index : 99;

    return `${order}-${safeName}`;
  }

  /**
   * Determines the file path for a module within the alepha package.
   * Groups related modules into subdirectories:
   * - api-users → api/users.md
   * - server-cookies → server/cookies.md
   * - server → server/core.md (when there are server-* modules)
   * - core → core.md
   * - batch → batch.md (standalone, no related modules)
   */
  getAlephaModuleFilePath(
    moduleName: string,
    subdirPrefixes: Set<string>,
  ): { subdir: string | null; filename: string } {
    if (moduleName === "core") {
      return { subdir: null, filename: "core.md" };
    }

    const hyphenIndex = moduleName.indexOf("-");
    const prefix =
      hyphenIndex === -1 ? moduleName : moduleName.substring(0, hyphenIndex);

    // Check if this prefix should be a subdirectory
    if (!subdirPrefixes.has(prefix)) {
      // Standalone module like "batch", "bucket", "orm"
      return { subdir: null, filename: `${moduleName}.md` };
    }

    if (hyphenIndex === -1) {
      // No hyphen but has related modules: "server" → "server/core.md"
      return { subdir: prefix, filename: "core.md" };
    }

    // Has hyphen: "server-cookies" → "server/cookies.md"
    const rest = moduleName.substring(hyphenIndex + 1);
    return { subdir: prefix, filename: `${rest}.md` };
  }

  readme = $command({
    name: "readme",
    description: "Generate package documentation and READMEs",
    handler: async ({ run }) => {
      this.log.info("Starting package documentation generation");
      const rootDir = join(import.meta.dirname, "../../..");
      const packagesDir = join(rootDir, "packages");
      const docsDir = join(rootDir, "docs/3-packages");

      this.log.debug(`Root directory: ${rootDir}`);
      this.log.debug(`Packages directory: ${packagesDir}`);
      this.log.debug(`Docs directory: ${docsDir}`);

      // Clean and recreate docs directory
      await fs.rm(docsDir, { recursive: true, force: true });
      await fs.mkdir(docsDir, { recursive: true });
      this.log.trace("Cleaned and recreated docs directory");

      let dirents: Dirent[];

      try {
        dirents = await fs.readdir(packagesDir, { withFileTypes: true });
        this.log.debug(`Found ${dirents.length} entries in packages directory`);
      } catch (error) {
        this.log.error(`Could not read packages directory at: ${packagesDir}`);
        throw error;
      }

      // First pass: collect all package names and alepha modules
      const alephaModules: string[] = [];
      const allPackageNames: string[] = [];

      for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;

        const packagePath = join(packagesDir, dirent.name);
        const pkgJsonPath = join(packagePath, "package.json");

        try {
          const pkgJsonContent = await fs.readFile(pkgJsonPath, "utf-8");
          const pkgJson = JSON.parse(pkgJsonContent);

          if (pkgJson.private) continue;

          allPackageNames.push(pkgJson.name);

          if (pkgJson.name === "alepha") {
            const modules = this.extractModules(pkgJson, packagePath);
            if (modules) {
              alephaModules.push(...modules.map((m) => m.name));
            }
          }
        } catch {
          // Skip packages without valid package.json
        }
      }

      this.log.debug(`Found packages: ${allPackageNames.join(", ")}`);

      // Determine which prefixes should be subdirectories
      const prefixCounts = new Map<string, number>();
      for (const mod of alephaModules) {
        const hyphenIndex = mod.indexOf("-");
        const prefix = hyphenIndex === -1 ? mod : mod.substring(0, hyphenIndex);
        prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
      }

      const subdirPrefixes = new Set<string>();
      for (const [prefix, count] of prefixCounts) {
        if (count > 1) {
          subdirPrefixes.add(prefix);
        }
      }

      this.log.debug(
        `Subdirectory prefixes for alepha: ${[...subdirPrefixes].join(", ")}`,
      );

      const stats = {
        generated: 0,
        updated: 0,
        skipped: 0,
      };

      for (const dirent of dirents) {
        if (!dirent.isDirectory()) {
          this.log.trace(`Skipping non-directory: ${dirent.name}`);
          continue;
        }

        await run(`process ${dirent.name}`, async () => {
          this.log.debug(`Processing package: ${dirent.name}`);
          const packagePath = join(packagesDir, dirent.name);
          const pkgJsonPath = join(packagePath, "package.json");

          let pkgJson: any;

          try {
            const pkgJsonContent = await fs.readFile(pkgJsonPath, "utf-8");
            pkgJson = JSON.parse(pkgJsonContent);
            this.log.trace(`Read package.json for ${dirent.name}`);
          } catch {
            this.log.warn(`Failed to read package.json for ${dirent.name}`);
            stats.skipped++;
            return;
          }

          if (pkgJson.private) {
            this.log.debug(`Skipping private package: ${dirent.name}`);
            stats.skipped++;
            return;
          }

          // Use real package name (alepha, @alepha/react, etc.)
          const realPkgName: string = pkgJson.name;
          const packageDirName = this.getPackageDirName(
            realPkgName,
            allPackageNames,
          );
          const packageDocsDir = join(docsDir, packageDirName);

          // Check if package has multiple modules
          const modules = this.extractModules(pkgJson, packagePath);

          if (modules) {
            // Create package directory only for multi-module packages
            await fs.mkdir(packageDocsDir, { recursive: true });
            this.log.debug(
              `Creating multi-module documentation for ${realPkgName}`,
            );

            for (const module of modules) {
              this.log.debug(`Generating docs for module: ${module.name}`);
              const markdown = await this.generateModuleMarkdown(
                pkgJson,
                module.name,
                module.sourcePath,
                realPkgName,
              );

              if (markdown === null) {
                this.log.debug(`Skipped module: ${module.name}`);
                stats.skipped++;
                continue;
              }

              // Determine file path based on package type
              let targetDir: string;
              let filename: string;

              if (realPkgName === "alepha") {
                const { subdir, filename: fname } =
                  this.getAlephaModuleFilePath(module.name, subdirPrefixes);
                targetDir = subdir
                  ? join(packageDocsDir, subdir)
                  : packageDocsDir;
                filename = fname;
              } else {
                // For @alepha/* packages, use module name directly
                targetDir = packageDocsDir;
                filename = `${module.name}.md`;
              }

              await fs.mkdir(targetDir, { recursive: true });
              const markdownPath = join(targetDir, filename);
              await fs.writeFile(markdownPath, markdown, "utf-8");
              this.log.debug(`Wrote module docs: ${markdownPath}`);
              stats.generated++;
            }
          } else {
            // Single module package - write as file directly, not directory with core.md
            this.log.debug(
              `Creating single-module documentation for ${realPkgName}`,
            );
            const sourcePath = join(packagePath, "src");

            const markdown = await this.generateModuleMarkdown(
              pkgJson,
              dirent.name,
              sourcePath,
              realPkgName,
            );

            if (markdown === null) {
              this.log.debug(`Skipped package: ${realPkgName}`);
              stats.skipped++;
            } else {
              // Single module packages become a file directly (e.g., 7-@alepha-devtools.md)
              const markdownPath = join(docsDir, `${packageDirName}.md`);
              await fs.writeFile(markdownPath, markdown, "utf-8");
              this.log.debug(`Wrote single-module docs: ${markdownPath}`);
              stats.generated++;
            }
          }

          // Generate README.md for package
          this.log.debug(`Generating README for ${realPkgName}`);

          // Special case: alepha package gets root README.md
          if (realPkgName === "alepha") {
            const rootReadmePath = join(rootDir, "README.md");
            const packageReadmePath = join(packagePath, "README.md");
            this.log.debug(`Copying root README to ${realPkgName} package`);
            const rootReadme = await fs.readFile(rootReadmePath, "utf-8");
            await fs.writeFile(packageReadmePath, rootReadme, "utf-8");
            this.log.debug(`Copied README to: ${packageReadmePath}`);
          } else {
            const readme = await this.generatePackageReadme(
              pkgJson,
              packagePath,
              realPkgName,
            );
            const readmePath = join(packagePath, "README.md");
            await fs.writeFile(readmePath, readme, "utf-8");
            this.log.debug(`Wrote README to: ${readmePath}`);
          }
          stats.updated++;
        });
      }

      this.log.info(
        `Documentation generation complete: ${stats.generated} docs generated, ${stats.updated} READMEs updated, ${stats.skipped} skipped`,
      );
    },
  });

  llms = $command({
    name: "llms",
    description: "Generate llms.txt file from documentation",
    handler: async ({ run }) => {
      this.log.info("Starting llms.txt generation");
      const docsDir = join(import.meta.dirname, "../node_modules/.docs");
      const outputDir = join(import.meta.dirname, "../dist/public");
      const outputFile = join(outputDir, "llms.txt");

      this.log.debug(`Docs directory: ${docsDir}`);
      this.log.debug(`Output file: ${outputFile}`);

      await run("scan markdown files", async () => {
        // Check if docs directory exists
        try {
          await fs.access(docsDir);
          this.log.trace("Docs directory exists");
        } catch {
          this.log.error(`Docs directory not found: ${docsDir}`);
          throw new Error(`Docs directory not found: ${docsDir}`);
        }
      });

      let markdownFiles: string[] = [];

      await run("find markdown files", async () => {
        const files = await fs.readdir(docsDir);
        markdownFiles = files
          .filter((file) => file.endsWith(".md"))
          .map((file) => join(docsDir, file))
          .sort(); // Sort for consistent order
        this.log.debug(`Found ${markdownFiles.length} markdown files`);
      });

      let concatenatedContent = "";

      await run("concatenate markdown files", async () => {
        for (const file of markdownFiles) {
          this.log.trace(`Reading file: ${file}`);
          const content = await fs.readFile(file, "utf-8");
          const fileName = path.basename(file);
          concatenatedContent += `# ${fileName}\n\n${content}\n\n---\n\n`;
          this.log.trace(`Added ${content.length} chars from ${fileName}`);
        }
        this.log.debug(
          `Total concatenated content: ${concatenatedContent.length} chars`,
        );
      });

      await run("write llms.txt", async () => {
        // Create output directory if it doesn't exist
        await fs.mkdir(outputDir, { recursive: true });
        this.log.trace(`Created/verified output directory: ${outputDir}`);

        // Write the concatenated content
        await fs.writeFile(outputFile, concatenatedContent, "utf-8");
        this.log.debug(
          `Wrote ${concatenatedContent.length} chars to ${outputFile}`,
        );
      });

      this.log.info(`Successfully created: ${outputFile}`);
      this.log.info(
        `Total content length: ${concatenatedContent.length} characters`,
      );
      this.log.info(`Files processed: ${markdownFiles.length}`);
    },
  });

  docs = $command({
    name: "docs",
    description: "Generate documentation for the website",
    handler: async ({ run }) => {
      this.log.info("Starting website documentation generation");
      const rootDir = join(import.meta.dirname, "../../..");
      const outputDir = join(import.meta.dirname, "../node_modules/.docs");
      const docsDir = join(rootDir, "docs");

      this.log.debug(`Root directory: ${rootDir}`);
      this.log.debug(`Output directory: ${outputDir}`);
      this.log.debug(`Docs directory: ${docsDir}`);

      await run("clean output directory", async () => {
        await rm(outputDir, { force: true, recursive: true });
        this.log.trace("Removed old output directory");
        await mkdir(outputDir, { recursive: true });
        this.log.trace("Created fresh output directory");
      });

      const items: DocItem[] = [];

      await run("parse /docs", async () => {
        await this.scanDocsDir(docsDir, "", items, rootDir, 0);
        this.log.debug(`Parsed ${items.length} docs from /docs`);
      });

      await run("write", async () => {
        const TAG = "%TBRM%";
        const result: Array<any> = [];

        for (const item of items) {
          this.log.trace(`Writing doc: ${item.slug}`);
          const content = item.content
            .replaceAll("`", "\\`")
            .replaceAll("${", "\\${")
            .replaceAll("\t", "  ");

          const filename = `${item.slug}.ts`;
          await writeFile(
            path.join(outputDir, filename),
            `export default \`${content}\``,
          );

          const category = item.category.split("/")[0];
          await writeFile(
            path.join(outputDir, `${category}-${item.originalName}`),
            item.originalContent,
          );

          result.push({
            slug: item.slug,
            name: item.name,
            description: item.description,
            path: item.path,
            category: item.category,
            order: item.order,
            level: item.level,
            readingTime: item.readingTime,
            lastModified: item.lastModified,
            keywords: item.keywords,
            content: `${TAG}() => import('./${filename}').then(it => it.default)${TAG}`,
          });
        }
        this.log.debug(`Wrote ${result.length} doc files`);

        for (const key of Object.keys(snippets) as Array<
          keyof typeof snippets
        >) {
          this.log.trace(`Rendering snippet: ${key}`);
          snippets[key] = await this.renderContent(
            `\`\`\`tsx nolines\n${snippets[key].trim()}\n\`\`\``,
          );
        }

        const treeData = this.buildTree(items);
        this.log.debug("Built navigation tree");

        // Custom JSON replacer to handle POSITIVE_INFINITY
        const jsonReplacer = (_key: string, value: any) => {
          if (value === Number.POSITIVE_INFINITY) {
            return 9999;
          }
          return value;
        };

        const outputFilepath = join(outputDir, "index.ts");
        const outputFileContent = `
					export const docs = ${JSON.stringify(result, jsonReplacer, 2)};
					export const tree = ${JSON.stringify(treeData, jsonReplacer, 2)};
					export const snippets = ${JSON.stringify(snippets, null, 2)};
					`.trim();

        await writeFile(
          outputFilepath,
          outputFileContent.replace(new RegExp(`"?${TAG}"?`, "g"), ""),
        );
        this.log.debug(`Wrote index file: ${outputFilepath}`);
      });

      this.log.info("Website documentation generation complete");
    },
  });

  extractOrder(name: string): number {
    const match = name.match(/^(\d+)-/);
    const order = match
      ? Number.parseInt(match[1], 10)
      : Number.POSITIVE_INFINITY;
    this.log.trace(`Extracted order ${order} from: ${name}`);
    return order;
  }

  cleanName(name: string): string {
    const cleaned = name.replace(/^\d+-/, "");
    this.log.trace(`Cleaned name "${name}" to "${cleaned}"`);
    return cleaned;
  }

  sortByOrder<T extends { name: string }>(items: T[]): T[] {
    this.log.trace(`Sorting ${items.length} items by order`);
    return items.sort((a, b) => {
      const orderA = this.extractOrder(a.name);
      const orderB = this.extractOrder(b.name);

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return a.name.localeCompare(b.name);
    });
  }

  createMarked() {
    this.log.debug("Creating Marked instance with syntax highlighting");
    const marked = new Marked();

    const renderer = {
      heading: ({ text, depth }: Tokens.Heading) => {
        const slug = text
          .replace(/\//g, "-")
          .replace(/[()`:/@"]/g, "")
          .trim()
          .replace(/ /g, "-")
          .toLowerCase();

        // Escape quotes for HTML attribute (strip backticks for clean data attribute)
        const escapedText = text.replace(/"/g, "&quot;").replace(/`/g, "");

        // Convert inline code (backticks) to <code> tags
        const htmlText = text.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Anchor div for scroll targeting - small negative offset for visual breathing room
        return `
<div id="${slug}" data-depth="${depth}" data-heading="${escapedText}" style="position: relative; top: -16px"></div>
<h${depth} class="doc-heading"><a href="#${slug}" class="heading-anchor">#</a>${htmlText}</h${depth}>`.trim();
      },
      code: ({ text, lang }: Tokens.Code) => {
        // Extract actual language and meta from info string
        // marked's `lang` contains full info string: "typescript filename="x.ts""
        const langParts = (lang || "").split(/\s+/);
        const actualLang = langParts[0] || "";
        const meta = langParts.slice(1).join(" ") || null;

        // Check if this is a package manager command (bash/sh or no lang specified)
        const isBashLike =
          !actualLang || actualLang === "bash" || actualLang === "sh";
        if (isBashLike && this.isPackageManagerCommand(text)) {
          return this.renderPackageManagerBlock(text);
        }

        // Use enhanced block for languages with line numbers
        if (
          actualLang &&
          this.lineNumberLanguages.has(actualLang.toLowerCase())
        ) {
          return this.renderEnhancedCodeBlock(text, actualLang, meta);
        }

        const language = hljs.getLanguage(actualLang || "")
          ? actualLang
          : "plaintext";
        const highlighted = hljs.highlight(text, {
          language: language || "plaintext",
        }).value;

        // Encode raw code as base64 to safely store in data attribute
        const base64Code = Buffer.from(text).toString("base64");

        // Display name for the language
        const langDisplay = actualLang || "bash";

        return `
<div class="code-block">
  <div class="code-block-header">
    <span class="code-block-lang">${langDisplay}</span>
    <button class="code-block-copy" data-code="${base64Code}" onclick="(function(btn){
      var code = atob(btn.getAttribute('data-code'));
      navigator.clipboard.writeText(code);
      btn.textContent = 'Copied!';
      setTimeout(function(){ btn.textContent = 'Copy'; }, 2000);
    })(this)">Copy</button>
  </div>
  <pre><code class="hljs language-${language}">${highlighted}</code></pre>
</div>`.trim();
      },
    };

    marked.use({ renderer });
    marked.use({
      gfm: true,
    });

    this.log.trace("Marked instance created");
    return marked;
  }

  async scanDocsDir(
    dir: string,
    category: string,
    items: DocItem[],
    rootDir: string,
    level: number,
    maxDepth = 3,
  ) {
    if (level > maxDepth) {
      this.log.trace(`Max depth reached at ${dir}`);
      return;
    }

    this.log.debug(`Scanning docs directory: ${dir} (level ${level})`);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    this.log.trace(`Found ${entries.length} entries in ${dir}`);

    const sortedEntries = this.sortByOrder(
      entries.map((e) => ({ name: e.name, entry: e })),
    ).map((e) => e.entry);

    for (const entry of sortedEntries) {
      const entryPath = join(dir, entry.name);
      const cleanedName = this.cleanName(entry.name);

      if (entry.isDirectory()) {
        // Preserve original name with order prefix in category path
        const newCategory = category ? `${category}/${entry.name}` : entry.name;
        this.log.trace(`Entering directory: ${newCategory}`);
        await this.scanDocsDir(
          entryPath,
          newCategory,
          items,
          rootDir,
          level + 1,
          maxDepth,
        );
      } else if (entry.name.endsWith(".md")) {
        this.log.trace(`Processing markdown file: ${entry.name}`);
        const originalContent = await readFile(entryPath, "utf-8");
        const content = await this.renderContent(originalContent);
        const relativePath = path.relative(rootDir, entryPath);

        const filename = cleanedName.replace(".md", "");
        const categoryPath = category || "root";
        const fullSlug = this.getFullSlug(categoryPath, filename);

        const readingTime = this.calculateReadingTime(originalContent);
        const lastModified = await this.getGitLastModified(entryPath);
        const keywords = this.extractKeywords(originalContent);

        const item = {
          slug: fullSlug,
          name: this.pretty(filename),
          description: "",
          content,
          originalContent,
          originalName: entry.name,
          path: relativePath,
          category: categoryPath,
          order: this.extractOrder(entry.name),
          level,
          readingTime,
          lastModified,
          keywords,
        };
        items.push(item);
        this.log.debug(
          `Added doc item: ${item.slug} (${keywords.length} keywords)`,
        );
      }
    }
  }

  /**
   * Generate full slug including category path
   * Examples:
   * - category: "1-guides", filename: "introduction" → "guides-introduction"
   * - category: "2-concepts", filename: "primitives" → "concepts-primitives"
   * - category: "3-packages/alepha", filename: "api-files" → "packages-alepha-api-files"
   */
  getFullSlug(categoryPath: string, filename: string): string {
    this.log.trace(
      `Generating full slug for category: ${categoryPath}, filename: ${filename}`,
    );

    // Split the category path and clean each part
    const parts = categoryPath.split("/").map((part) => this.cleanName(part));

    // Add the filename
    parts.push(this.cleanName(filename));

    // Join with dashes and create slug
    const fullSlug = this.slug(parts.join("-"));
    this.log.trace(`Generated slug: ${fullSlug}`);

    return fullSlug;
  }

  /**
   * Generate display name for package documentation.
   * Returns just the final part (slug) since the parent directory already provides context.
   * e.g., "Api Files" -> "api-files" (not "@alepha/plugins/api-files")
   */
  getPackageDisplayName(_categoryPath: string, itemName: string): string {
    // Just return the slug of the item name - the directory structure provides context
    return this.slug(itemName);
  }

  buildTree(items: DocItem[]): DocNode[] {
    this.log.debug(`Building navigation tree from ${items.length} items`);
    const tree: DocNode[] = [];
    const categoryMap = new Map<string, DocNode>();

    // Sort items by category depth and order
    const sortedItems = [...items].sort((a, b) => {
      const depthA = a.category.split("/").length;
      const depthB = b.category.split("/").length;
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      return a.order - b.order;
    });

    for (const item of sortedItems) {
      const parts = item.category.split("/");

      // Build nodes for each level of the category path
      for (let i = 0; i < parts.length; i++) {
        const categoryPath = parts.slice(0, i + 1).join("/");
        const categoryName = parts[i];

        if (!categoryMap.has(categoryPath)) {
          // Check if this is inside packages section
          const packagesIndex = parts.findIndex((p) => p.startsWith("3-"));
          const isInsidePackages = packagesIndex !== -1 && i > packagesIndex;

          // Determine display name
          let displayName: string;
          if (isInsidePackages) {
            // Strip order prefix and convert to package name
            // 1-alepha → alepha, 2-@alepha-react → @alepha/react
            const withoutPrefix = categoryName.replace(/^\d+-/, "");
            displayName = withoutPrefix.replace(/^@alepha-/, "@alepha/");
          } else {
            // Use slug format for non-package directories (lowercase, hyphen-separated)
            displayName = this.slug(categoryName);
          }

          const node: DocNode = {
            slug: this.slug(categoryName),
            name: displayName,
            order: this.extractOrder(categoryName),
            children: [],
          };

          if (i === 0) {
            tree.push(node);
            this.log.trace(`Added root node: ${node.name}`);
          } else {
            const parentPath = parts.slice(0, i).join("/");
            const parent = categoryMap.get(parentPath);
            if (parent) {
              parent.children = parent.children || [];
              parent.children.push(node);
              this.log.trace(
                `Added child node: ${node.name} to ${parent.name}`,
              );
            }
          }

          categoryMap.set(categoryPath, node);
        }
      }

      // Add the document as a leaf node
      const parentNode = categoryMap.get(item.category);
      if (parentNode) {
        parentNode.children = parentNode.children || [];

        // Use slug format for all names (lowercase, hyphen-separated)
        const displayName = this.slug(item.name);

        parentNode.children.push({
          slug: item.slug,
          name: displayName,
          order: item.order,
          href: `/docs/${item.slug}`,
          description: item.description,
          keywords: item.keywords,
        });
        this.log.trace(`Added doc leaf: ${displayName}`);
      }
    }

    // Sort all children by order
    const sortChildren = (nodes: DocNode[]) => {
      nodes.sort((a, b) => {
        if (a.order !== b.order) {
          return a.order - b.order;
        }
        return a.name.localeCompare(b.name);
      });

      for (const node of nodes) {
        if (node.children) {
          sortChildren(node.children);
        }
      }
    };

    sortChildren(tree);
    this.log.debug(`Built tree with ${tree.length} root nodes`);

    return tree;
  }

  slug(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/(\d+)-/, "") // remove leading numbers
      .replace(/[/\\]/g, "-")
      .replace(/\s+/g, "-") // replace spaces with dashes
      .replace("@", "");
    this.log.trace(`Generated slug "${slug}" from "${name}"`);
    return slug;
  }

  pretty(name: string) {
    const pretty = name
      .replace(/(\d+)-/, "")
      .replace(/[-/\\]/g, " ")
      .replace("@", "")
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    this.log.trace(`Prettified "${name}" to "${pretty}"`);
    return pretty;
  }

  renderContent(content: string) {
    this.log.trace(`Rendering ${content.length} chars of markdown`);
    return this.marked.parse(content);
  }
}

run(DocsCliApp, {
  env: {
    LOG_FORMAT: "raw",
    LOG_LEVEL: "alepha.command:info,warn",
  },
});
