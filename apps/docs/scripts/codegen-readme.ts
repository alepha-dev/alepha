import { type Dirent, promises as fs } from "node:fs";
import { cp } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * A simple utility function to format a package name like 'bucket-azure'
 * into a more readable 'Bucket Azure'.
 */
function formatPackageName(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface DescriptorInfo {
  name: string;
  description: string;
}

/**
 * Cleans a raw JSDoc block into a readable string.
 * @param jsDocBlock - The raw string content from inside /** ... * /.
 * @returns A clean, single-line description.
 */
function cleanJsDoc(jsDocBlock: string): string {
  return jsDocBlock
    .split("\n")
    .map((line) => line.replace(/ \* ?/, ""))
    .filter((line) => !line.startsWith("@")) // Ignore tags like @param or @see
    .join("\n")
    .trim();
}

/**
 * Reads the `src/index.ts` file of a package and extracts the JSDoc comment
 * that contains "@module".
 * @param filePath - The full path to the index.ts file.
 * @returns The extracted description string, or null if not found or no @module tag.
 */
async function extractModuleDescription(
  filePath: string,
): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    // Regex to find all JSDoc blocks in the file.
    const regex = /\/\*\*\s*\n([\s\S]*?)\s*\*\//g;
    const matches = Array.from(content.matchAll(regex));

    // Search through all JSDoc comments to find one with "@module"
    for (const match of matches) {
      if (match[1].includes("@module")) {
        return cleanJsDoc(match[1]);
      }
    }

    return null;
  } catch (error: any) {
    if (error.code === "ENOENT") return null; // File doesn't exist, which is fine.
    console.error(
      `\n❌ Error parsing module description from ${filePath}:`,
      error,
    );
    return null;
  }
}

/**
 * Reads a descriptor file and extracts the JSDoc comment block
 * for the main exported descriptor function.
 */
async function extractDescriptorInfo(
  filePath: string,
  hook = false,
): Promise<DescriptorInfo | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const regex = hook
      ? /\/\*\*\s*\n([\s\S]*?)\s*\*\/\s*\nexport const (use\w+)/
      : /\/\*\*\s*\n([\s\S]*?)\s*\*\/\s*\nexport const (\$\w+)/;

    const matches = Array.from(content.matchAll(new RegExp(regex.source, "g")));

    for (const match of matches) {
      if (match[1].includes("@internal")) continue;

      return {
        name: match[2],
        description: cleanJsDoc(match[1]),
      };
    }

    return null;
  } catch (error) {
    console.error(`\n❌ Error parsing descriptor file ${filePath}:`, error);
    return null;
  }
}

/**
 * Reads a provider file and extracts the JSDoc comment block
 * for the main exported provider function.
 */
async function extractProviderInfo(
  filePath: string,
): Promise<DescriptorInfo | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const regex = /\/\*\*\s*\n([\s\S]*?)\s*\*\/\s*\nexport class (\w+)/;

    const matches = Array.from(content.matchAll(new RegExp(regex.source, "g")));

    for (const match of matches) {
      if (match[1].includes("@internal")) continue;

      return {
        name: match[2],
        description: cleanJsDoc(match[1]),
      };
    }

    return null;
  } catch (error) {
    console.error(`\n❌ Error parsing provider file ${filePath}:`, error);
    return null;
  }
}

/**
 * Finds all descriptors in a package's `src/descriptors` directory.
 */
async function getDescriptorsInfo(
  packagePath: string,
  dirName: string = "descriptors",
): Promise<DescriptorInfo[]> {
  const descriptorsDir = join(packagePath, "src", dirName);
  try {
    const files = await fs.readdir(descriptorsDir, { withFileTypes: true });
    const descriptorPromises = files
      .filter((file) => file.isFile() && file.name.endsWith(".ts"))
      .map((file) =>
        extractDescriptorInfo(
          join(descriptorsDir, file.name),
          dirName === "hooks",
        ),
      );

    const results = await Promise.all(descriptorPromises);
    return results.filter((info): info is DescriptorInfo => info !== null);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Finds all providers in a package's `src/providers` directory.
 */
async function getProvidersInfo(
  packagePath: string,
): Promise<DescriptorInfo[]> {
  const providersDir = join(packagePath, "src", "providers");
  try {
    const files = await fs.readdir(providersDir, { withFileTypes: true });
    const providerPromises = files
      .filter((file) => file.isFile() && file.name.endsWith(".ts"))
      .map((file) => extractProviderInfo(join(providersDir, file.name)));

    const results = await Promise.all(providerPromises);
    return results.filter((info): info is DescriptorInfo => info !== null);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * The main function to generate README.md files for all packages.
 */
export async function generateReadmes(root: string, log = console.log) {
  log("🚀 Starting README generation...");

  const packagesDir = resolve(root, "../../packages");
  let dirents: Dirent[];

  try {
    dirents = await fs.readdir(packagesDir, { withFileTypes: true });
  } catch (error) {
    console.error(`❌ Could not read packages directory at: ${packagesDir}`);
    console.error(error);
    process.exit(1);
  }

  let generatedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  await cp(
    join(packagesDir, "../README.md"),
    join(packagesDir, "alepha/README.md"),
  );

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name === "alepha") continue;

    const packagePath = join(packagesDir, dirent.name);
    const pkgJsonPath = join(packagePath, "package.json");
    const readmePath = join(packagePath, "README.md");

    try {
      const pkgJsonContent = await fs.readFile(pkgJsonPath, "utf-8");
      const pkgJson = JSON.parse(pkgJsonContent);

      if (!pkgJson.description || pkgJson.private) {
        skippedCount++;
        continue;
      }

      const nameSegment = pkgJson.name.replace("@alepha/", "");
      const formattedName = formatPackageName(nameSegment);
      const moduleName = `Alepha${formattedName.replaceAll(" ", "")}`;

      const moduleDescription = await extractModuleDescription(
        join(
          packagePath,
          "src",
          nameSegment === "core" ? "Alepha.ts" : "index.ts",
        ),
      );
      const descriptors = await getDescriptorsInfo(packagePath);
      const hooks = await getDescriptorsInfo(packagePath, "hooks");
      const providers = await getProvidersInfo(packagePath);

      // --- Build the README content ---
      let readmeContent = `# Alepha ${formattedName}\n\n${pkgJson.description}\n`;

      readmeContent += `\n## Installation\n\nThis package is part of the Alepha framework and can be installed via the all-in-one package:\n\n\`\`\`bash\nnpm install alepha\n\`\`\`\n\n`;

      if (moduleDescription) {
        readmeContent += `## Module\n\n`;
        readmeContent += `${moduleDescription}\n`;
        if (nameSegment !== "core" && nameSegment !== "vite") {
          readmeContent += `\nThis module can be imported and used as follows:\n\n\`\`\`typescript\nimport { Alepha, run } from "alepha";\nimport { ${moduleName} } from "${pkgJson.name.replace("@", "").replace("-", "/")}";\n\nconst alepha = Alepha.create()\n\t.with(${moduleName});\n\nrun(alepha);\n\`\`\`\n`;
        }
      }

      if (descriptors.length > 0 || providers.length > 0 || hooks.length > 0) {
        readmeContent += `\n## API Reference\n`;
      }

      if (descriptors.length > 0) {
        readmeContent += `\n### Descriptors\n\nDescriptors are functions that define and configure various aspects of your application. They follow the convention of starting with \` $ \` and return configured descriptor instances.\n\nFor more details, see the [Descriptors documentation](/docs/descriptors).\n`;
        for (const desc of descriptors) {
          readmeContent += `\n#### ${desc.name}()\n\n${desc.description}\n`;
        }
      }

      if (hooks.length > 0) {
        readmeContent += `\n### Hooks\n\nHooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with \`use\` and return configured hook instances.\n`;
        for (const desc of hooks) {
          readmeContent += `\n#### ${desc.name}()\n\n${desc.description}\n`;
        }
      }

      if (providers.length > 0) {
        readmeContent += `\n### Providers\n\nProviders are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.\n\nFor more details, see the [Providers documentation](/docs/providers).\n`;
        providers.forEach((provider) => {
          readmeContent += `\n#### ${provider.name}\n\n${provider.description}\n`;
        });
      }

      // Check against existing file to prevent unnecessary writes
      let existingContent = "";
      try {
        existingContent = await fs.readFile(readmePath, "utf-8");
      } catch (readError: any) {
        if (readError.code !== "ENOENT") throw readError;
      }

      if (existingContent.trim() !== readmeContent.trim()) {
        await fs.writeFile(readmePath, readmeContent);
        if (existingContent) {
          updatedCount++;
          log(`  🔄 Updated ${pkgJson.name}`);
        } else {
          generatedCount++;
          log(`  ✅ Generated ${pkgJson.name}`);
        }
      } else {
        skippedCount++;
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        skippedCount++;
      } else {
        console.error(`\n❌ Error processing ${pkgJsonPath}:`, error);
      }
    }
  }

  log("\n✨ README generation complete!");
  log(
    `   Generated: ${generatedCount}, Updated: ${updatedCount}, Skipped/Unchanged: ${skippedCount}\n`,
  );
}
