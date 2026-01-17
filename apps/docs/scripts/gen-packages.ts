import { type Dirent, promises as fs } from "node:fs";
import { join } from "node:path";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type { EnvVarInfo, ModuleInfo, PrimitiveInfo } from "./interfaces.ts";

/**
 * Command for generating package documentation and READMEs
 */
export class PackagesCommand {
  protected log = $logger();

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
   * for the main exported provider class.
   *
   * Prefers the class whose name matches the filename (e.g., ReactServerProvider
   * from ReactServerProvider.ts), otherwise returns the first non-internal class.
   */
  async extractProviderInfo(filePath: string): Promise<PrimitiveInfo | null> {
    this.log.debug(`Extracting provider info from: ${filePath}`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      // Use negative lookahead (?!\/\*\*) to prevent matching across JSDoc blocks.
      // This ensures we only capture the JSDoc immediately preceding export class.
      const regex =
        /\/\*\*\s*\n((?:(?!\/\*\*)[\s\S])*?)\s*\*\/\s+export class (\w+)/g;

      const matches = Array.from(content.matchAll(regex));
      this.log.trace(`Found ${matches.length} potential providers`);

      // Extract filename without extension to match against class names
      const fileName =
        filePath
          .split("/")
          .pop()
          ?.replace(/\.tsx?$/, "") ?? "";

      // Collect all valid (non-internal) providers
      const providers: PrimitiveInfo[] = [];
      for (const match of matches) {
        if (match[1].includes("@internal")) {
          this.log.trace(`Skipping @internal provider: ${match[2]}`);
          continue;
        }

        providers.push({
          name: match[2],
          description: this.cleanJsDoc(match[1]),
        });
      }

      if (providers.length === 0) {
        this.log.trace("No providers found");
        return null;
      }

      // Prefer provider whose name matches the filename
      const matchingProvider = providers.find((p) => p.name === fileName);
      if (matchingProvider) {
        this.log.debug(
          `Extracted provider (matched filename): ${matchingProvider.name}`,
        );
        return matchingProvider;
      }

      // Fall back to first provider
      this.log.debug(`Extracted provider (first found): ${providers[0].name}`);
      return providers[0];
    } catch (error) {
      this.log.error(`Error parsing provider file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extracts environment variable schema from a file that uses $env().
   * Looks for patterns like `const envSchema = t.object({...})` followed by `$env(envSchema)`.
   */
  async extractEnvInfo(filePath: string): Promise<EnvVarInfo[]> {
    this.log.trace(`Extracting env info from: ${filePath}`);
    try {
      const content = await fs.readFile(filePath, "utf-8");

      // Check if file uses $env
      if (!content.includes("$env(")) {
        return [];
      }

      // Find the schema definition - look for t.object({ with env var patterns
      // Match: const envSchema = t.object({ ... });
      const schemaMatch = content.match(
        /const\s+envSchema\s*=\s*t\.object\(\{([\s\S]*?)\}\);/,
      );

      if (!schemaMatch) {
        this.log.trace(`No envSchema found in ${filePath}`);
        return [];
      }

      const schemaContent = schemaMatch[1];
      const envVars: EnvVarInfo[] = [];

      // Match field definitions using a simpler approach:
      // 1. Find field names that look like ENV_VAR_NAMES (uppercase with underscores)
      // 2. Extract their type, description, and default from the surrounding context
      const fieldNameRegex = /([A-Z][A-Z0-9_]+):/g;
      const fieldNames = Array.from(schemaContent.matchAll(fieldNameRegex)).map(
        (m) => m[1],
      );

      for (const name of fieldNames) {
        // Find the content after this field name up to the next field or end
        const fieldStartIndex = schemaContent.indexOf(`${name}:`);
        if (fieldStartIndex === -1) continue;

        // Find the next field or end of schema
        const nextFieldMatch = schemaContent
          .slice(fieldStartIndex + name.length)
          .match(/[A-Z][A-Z0-9_]+:/);
        const fieldEndIndex = nextFieldMatch
          ? fieldStartIndex +
            name.length +
            (nextFieldMatch.index ?? schemaContent.length)
          : schemaContent.length;

        const fieldContent = schemaContent.slice(fieldStartIndex, fieldEndIndex);

        // Check if field is optional
        const isOptional = fieldContent.includes("t.optional(");

        // Extract type (text, number, boolean, integer, etc.)
        const typeMatch = isOptional
          ? fieldContent.match(/t\.optional\(\s*t\.(\w+)/)
          : fieldContent.match(/:\s*t\.(\w+)/);
        const type = typeMatch ? typeMatch[1] : "unknown";

        // Extract description
        const descMatch = fieldContent.match(/description:\s*["']([^"']+)["']/);
        const description = descMatch ? descMatch[1] : undefined;

        // Extract default value
        const defaultMatch = fieldContent.match(/default:\s*([^,\n}]+)/);
        let defaultValue = defaultMatch ? defaultMatch[1].trim() : undefined;
        if (defaultValue) {
          defaultValue = defaultValue.replace(/^["']|["']$/g, "");
        }

        envVars.push({
          name,
          type,
          description,
          default: defaultValue,
          optional: isOptional || defaultValue !== undefined,
        });
      }

      if (envVars.length > 0) {
        this.log.debug(`Extracted ${envVars.length} env vars from ${filePath}`);
      }

      return envVars;
    } catch (error) {
      this.log.error(`Error extracting env info from ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Recursively finds all TypeScript files in a directory and extracts env vars.
   */
  async getEnvInfo(packagePath: string): Promise<EnvVarInfo[]> {
    this.log.debug(`Getting env info from: ${packagePath}`);
    const allEnvVars: EnvVarInfo[] = [];
    const seenNames = new Set<string>();

    const processDir = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);

          if (entry.isDirectory() && !entry.name.startsWith("__")) {
            await processDir(fullPath);
          } else if (
            entry.isFile() &&
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".spec.ts")
          ) {
            const envVars = await this.extractEnvInfo(fullPath);
            for (const envVar of envVars) {
              // Deduplicate by name (same env var may be used in multiple files)
              if (!seenNames.has(envVar.name)) {
                seenNames.add(envVar.name);
                allEnvVars.push(envVar);
              }
            }
          }
        }
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          this.log.error(`Error reading directory ${dirPath}:`, error);
        }
      }
    };

    await processDir(packagePath);

    // Sort by name for consistent output
    allEnvVars.sort((a, b) => a.name.localeCompare(b.name));

    this.log.debug(
      `Found ${allEnvVars.length} unique env vars in ${packagePath}`,
    );
    return allEnvVars;
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
      if (!typesPath.endsWith(".ts") && !typesPath.endsWith(".tsx")) {
        this.log.trace(
          `Skipping non-TypeScript export: ${key} -> ${typesPath}`,
        );
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

    for (const path of candidates) {
      try {
        await fs.access(path);
        this.log.trace(`Checking file: ${path}`);
        const description = await this.extractModuleDescription(path);
        if (description) {
          this.log.debug(`Found @module tag in: ${path}`);
          moduleDescription = description;
          break;
        }
        this.log.trace(`No @module tag in: ${path}`);
      } catch {
        this.log.trace(`File not found: ${path}`);
      }
    }

    // Skip modules without @module tag
    if (!moduleDescription) {
      this.log.debug(
        `Skipping module ${packageName}/${moduleName} - no @module tag found`,
      );
      return null;
    }

    const primitives = await this.getPrimitivesInfo(sourcePath);
    const hooks = await this.getPrimitivesInfo(sourcePath, "hooks");
    const providers = await this.getProvidersInfo(sourcePath);
    const envVars = await this.getEnvInfo(sourcePath);

    this.log.debug(
      `Found ${primitives.length} primitives, ${hooks.length} hooks, ${providers.length} providers, ${envVars.length} env vars`,
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

    if (
      primitives.length > 0 ||
      providers.length > 0 ||
      hooks.length > 0 ||
      envVars.length > 0
    ) {
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

    if (envVars.length > 0) {
      content += `\n### Environment Variables\n\nEnvironment variables used to configure this module. These can be set in your \`.env\` file or through your deployment configuration.\n`;
      content += `\n| Variable | Type | Default | Description |\n|----------|------|---------|-------------|\n`;
      for (const env of envVars) {
        const required = env.optional ? "" : "**Required**";
        const defaultVal = env.default ?? (env.optional ? "-" : required);
        const desc = env.description ?? "";
        content += `| \`${env.name}\` | ${env.type} | ${defaultVal} | ${desc} |\n`;
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
    const envVars = await this.getEnvInfo(join(packagePath, "src"));

    this.log.debug(
      `Found ${primitives.length} primitives, ${hooks.length} hooks, ${providers.length} providers, ${envVars.length} env vars`,
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

    if (
      primitives.length > 0 ||
      providers.length > 0 ||
      hooks.length > 0 ||
      envVars.length > 0
    ) {
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

    if (envVars.length > 0) {
      content += `\n### Environment Variables\n\nEnvironment variables used to configure this package.\n`;
      content += `\n| Variable | Type | Default | Description |\n|----------|------|---------|-------------|\n`;
      for (const env of envVars) {
        const required = env.optional ? "" : "**Required**";
        const defaultVal = env.default ?? (env.optional ? "-" : required);
        const desc = env.description ?? "";
        content += `| \`${env.name}\` | ${env.type} | ${defaultVal} | ${desc} |\n`;
      }
    }

    this.log.trace(`Generated README (${content.length} chars)`);
    return content;
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

  packages = $command({
    name: "gen:packages",
    description: "Generate package documentation and READMEs",
    handler: async ({ run, root }) => {
      this.log.debug("Starting package documentation generation");
      const rootDir = join(root, "../..");
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
              // Single module packages become a file directly (e.g., 7-@alepha-bucket-azure.md)
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

      this.log.debug(
        `Documentation generation complete: ${stats.generated} docs generated, ${stats.updated} READMEs updated, ${stats.skipped} skipped`,
      );
    },
  });
}
