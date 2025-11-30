import { type Dirent, promises as fs } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path, { join } from "node:path";
import { $inject, run } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import hljs from "highlight.js";
import { Marked, type Tokens } from "marked";
import { markedHighlight } from "marked-highlight";
import { theme } from "../src/config/theme.ts";
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
};

export type DocNode = {
  slug: string;
  name: string;
  order: number;
  children?: DocNode[];
  href?: string;
  description?: string;
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
      content += `\`\`\`bash\nnpm install alepha\n\`\`\`\n\n`;
    } else {
      content += `This module is part of the Alepha framework:\n\n\`\`\`bash\nnpm install ${pkgJson.name}\n\`\`\`\n\n`;
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

      // Ensure docs directory exists
      await fs.mkdir(docsDir, { recursive: true });
      this.log.trace("Created/verified docs directory");

      let dirents: Dirent[];

      try {
        dirents = await fs.readdir(packagesDir, { withFileTypes: true });
        this.log.debug(`Found ${dirents.length} entries in packages directory`);
      } catch (error) {
        this.log.error(`Could not read packages directory at: ${packagesDir}`);
        throw error;
      }

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

          let pkgJsonContent: string;
          let pkgJson: any;

          try {
            pkgJsonContent = await fs.readFile(pkgJsonPath, "utf-8");
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

          const packageName =
            pkgJson.name?.replace("@alepha/", "") || dirent.name;

          // Check if package has multiple modules
          const modules = this.extractModules(pkgJson, packagePath);

          if (modules) {
            // Create directory for multi-module package
            this.log.debug(
              `Creating multi-module documentation for ${packageName}`,
            );
            const packageDocsDir = join(docsDir, packageName);
            await fs.mkdir(packageDocsDir, { recursive: true });
            this.log.trace(`Created directory: ${packageDocsDir}`);

            for (const module of modules) {
              this.log.debug(`Generating docs for module: ${module.name}`);
              const markdown = await this.generateModuleMarkdown(
                pkgJson,
                module.name,
                module.sourcePath,
                packageName,
              );

              // Skip if no @module tag found
              if (markdown === null) {
                this.log.debug(`Skipped module: ${module.name}`);
                stats.skipped++;
                continue;
              }

              const markdownPath = join(packageDocsDir, `${module.name}.md`);
              await fs.writeFile(markdownPath, markdown, "utf-8");
              this.log.debug(`Wrote module docs: ${markdownPath}`);
              stats.generated++;
            }
          } else {
            // Single module package - create single markdown file
            this.log.debug(
              `Creating single-module documentation for ${packageName}`,
            );
            const sourcePath = join(packagePath, "src");

            const markdown = await this.generateModuleMarkdown(
              pkgJson,
              packageName,
              sourcePath,
              packageName,
            );

            // Skip if no @module tag found
            if (markdown === null) {
              this.log.debug(`Skipped package: ${packageName}`);
              stats.skipped++;
            } else {
              const markdownPath = join(docsDir, `${packageName}.md`);
              await fs.writeFile(markdownPath, markdown, "utf-8");
              this.log.debug(`Wrote single-module docs: ${markdownPath}`);
              stats.generated++;
            }
          }

          // Generate README.md for package
          this.log.debug(`Generating README for ${packageName}`);

          // Special case: alepha package gets root README.md
          if (packageName === "alepha") {
            const rootReadmePath = join(rootDir, "README.md");
            const packageReadmePath = join(packagePath, "README.md");
            this.log.debug(`Copying root README to ${packageName} package`);
            const rootReadme = await fs.readFile(rootReadmePath, "utf-8");
            await fs.writeFile(packageReadmePath, rootReadme, "utf-8");
            this.log.debug(`Copied README to: ${packageReadmePath}`);
          } else {
            const readme = await this.generatePackageReadme(
              pkgJson,
              packagePath,
              packageName,
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
            content: `${TAG}() => import('./${filename}').then(it => it.default)${TAG}`,
          });
        }
        this.log.debug(`Wrote ${result.length} doc files`);

        for (const key of Object.keys(snippets) as Array<
          keyof typeof snippets
        >) {
          this.log.trace(`Rendering snippet: ${key}`);
          snippets[key] = await this.renderContent(
            `\`\`\`tsx\n${snippets[key].trim()}\n\`\`\``,
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
    const marked = new Marked(
      markedHighlight({
        emptyLangClass: "hljs",
        langPrefix: "hljs language-",
        highlight(code, lang) {
          const language = hljs.getLanguage(lang) ? lang : "plaintext";
          return hljs.highlight(code, { language }).value;
        },
      }),
    );

    const renderer = {
      heading: ({ text, depth }: Tokens.Heading) => {
        const slug = text
          .replace(/\//g, "-")
          .replace(/[()`:/@]/g, "")
          .trim()
          .replace(/ /g, "-")
          .toLowerCase();

        // trick I learned by inspecting the mantine.dev website
        // instead of go-to <h1>, you go-to a <div> with metadata with a position top negative
        // it's the only way to manage all use-cases of fixed <header>
        return `
					<div id="${slug}" data-depth="${depth}" data-heading="${text}" style="position: relative; top: -${theme.headerHeight.base}px"></div>
					<h${depth}>${text}</h${depth}>
				`.trim();
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
        };
        items.push(item);
        this.log.debug(`Added doc item: ${item.slug}`);
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
   * Generate display name for package documentation
   */
  getPackageDisplayName(categoryPath: string, itemName: string): string {
    const parts = categoryPath.split("/");

    // Check if we're in the packages section
    const packagesIndex = parts.findIndex((p) => p.startsWith("3-"));
    if (packagesIndex === -1) {
      return itemName;
    }

    // Get the package name (first part after "3-packages")
    const packageName = parts[packagesIndex + 1];

    if (!packageName) {
      // Direct child of packages section - single package with no modules
      // Format: @alepha/packagename (e.g., "@alepha/ui", "@alepha/devtools")
      const cleanedItemName = this.cleanName(itemName);
      return `@alepha/${this.slug(cleanedItemName)}`;
    }

    const cleanedPackageName = this.cleanName(packageName);
    // Convert the prettified name back to slug format (e.g., "Api Files" -> "api-files")
    const itemSlug = this.slug(itemName);

    // Special case: "core" doesn't exist as a separate module, it's the package itself
    if (itemSlug === "core") {
      if (cleanedPackageName === "alepha") {
        return "alepha";
      }
      return `@alepha/${cleanedPackageName}`;
    }

    // If it's the alepha package
    if (cleanedPackageName === "alepha") {
      return `alepha/${itemSlug}`;
    }

    // For other packages like react, bucket-azure, etc.
    return `@alepha/${cleanedPackageName}/${itemSlug}`;
  }

  /**
   * Generate display name for package category node
   */
  getPackageCategoryName(categoryPath: string, categoryName: string): string {
    const parts = categoryPath.split("/");
    const packagesIndex = parts.findIndex((p) => p.startsWith("3-"));

    if (packagesIndex === -1) {
      return this.pretty(categoryName);
    }

    // This is a package directory under "3-packages"
    const cleanedName = this.cleanName(categoryName);

    if (cleanedName === "alepha") {
      return "alepha";
    }

    return `@alepha/${cleanedName}`;
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
          // Check if this is a package category node
          const isPackageNode = parts.some((p) => p.startsWith("3-")) && i > 0;

          const node: DocNode = {
            slug: this.slug(categoryName),
            name: isPackageNode
              ? this.getPackageCategoryName(categoryPath, categoryName)
              : this.pretty(categoryName),
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

        // Check if this is a package documentation item
        const isPackageDoc = item.category.includes("3-packages");
        const displayName = isPackageDoc
          ? this.getPackageDisplayName(item.category, item.name)
          : item.name;

        parentNode.children.push({
          slug: item.slug,
          name: displayName,
          order: item.order,
          href: `/docs/${item.slug}`,
          description: item.description,
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
