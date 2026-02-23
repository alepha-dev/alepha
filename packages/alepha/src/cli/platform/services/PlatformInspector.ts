import { $inject, $use, Alepha, AlephaError, t } from "alepha";
import { Asker } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import {
  type EnvironmentConfig,
  platformOptions,
} from "../../atoms/platformOptions.ts";
import { NamingService } from "./NamingService.ts";

export interface ResolvedPlatformConfig {
  project: string;
  defaultEnv: string;
  environments: Record<string, EnvironmentConfig>;
  isMonorepo: boolean;
  appPaths: string[];
  appNames: Map<string, string>;
}

/**
 * Reads platform config and resolves project topology.
 *
 * Validates project names, app paths, and environment configuration.
 * Does NOT introspect app code for resources — that happens at deploy time
 * via ViteBuildProvider.
 */
export class PlatformInspector {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly asker = $inject(Asker);
  protected readonly options = $use(platformOptions);
  protected readonly naming = $inject(NamingService);

  /**
   * Resolve and validate the full platform configuration.
   */
  public async resolveConfig(root: string): Promise<ResolvedPlatformConfig> {
    if (!this.options.platform) {
      if (this.alepha.isCI()) {
        throw new AlephaError(
          'Platform is not configured. Add a "platform" section to alepha.config.ts:\n\n' +
            "  export default defineConfig({\n" +
            "    platform: {\n" +
            "      environments: {\n" +
            '        prod: { adapter: "cloudflare" },\n' +
            "      },\n" +
            "    },\n" +
            "  });",
        );
      }

      await this.setupWizard(root);
    }

    // Re-read after potential wizard
    const opts = this.options;
    const platform = opts.platform!;

    // Resolve project name
    const project = await this.resolveProjectName(root, opts.name);

    // Resolve apps
    const appPaths = opts.apps ?? [];
    const isMonorepo = appPaths.length > 0;
    const appNames = new Map<string, string>();

    for (const appPath of appPaths) {
      const name = await this.resolveAppName(root, appPath);
      appNames.set(appPath, name);
    }

    return {
      project: this.naming.slugify(project),
      defaultEnv: platform.default ?? "prod",
      environments: platform.environments as Record<string, EnvironmentConfig>,
      isMonorepo,
      appPaths,
      appNames,
    };
  }

  /**
   * Interactive wizard to create alepha.config.ts when missing.
   *
   * Asks for adapter and project name, writes the config file,
   * and sets the platformOptions atom in memory.
   */
  protected async setupWizard(root: string): Promise<void> {
    const { ask } = this.asker;

    this.log.info("No alepha.config.ts found. Let's set one up.\n");

    // Adapter
    const adapter = await ask("Which platform adapter?", {
      schema: t.enum(["cloudflare"]),
    });

    // Name — try package.json first
    let name: string | undefined;
    try {
      const pkgPath = this.fs.join(root, "package.json");
      const pkg = await this.fs.readJsonFile<{ name?: string }>(pkgPath);
      name = pkg.name;
    } catch {}

    if (!name) {
      name = await ask("Project name?", { schema: t.text() });
    }

    // Write alepha.config.ts
    const configPath = this.fs.join(root, "alepha.config.ts");
    const content = [
      'import { defineConfig } from "alepha/cli";',
      "",
      "export default defineConfig({",
      `  name: "${name}",`,
      "  platform: {",
      "    environments: {",
      `      prod: { adapter: "${adapter}" },`,
      "    },",
      "  },",
      "});",
      "",
    ].join("\n");

    await this.fs.writeFile(configPath, content);
    this.log.info(`Created ${configPath}\n`);

    // Set atom in memory so resolveConfig() can continue
    this.alepha.set(platformOptions, {
      name,
      platform: {
        environments: {
          prod: { adapter },
        },
      },
    });
  }

  /**
   * Resolve a specific environment, validating it exists.
   */
  public async resolveEnvironment(
    root: string,
    envName: string,
  ): Promise<EnvironmentConfig> {
    const config = await this.resolveConfig(root);
    const envConfig = config.environments[envName];

    if (!envConfig) {
      const available = Object.keys(config.environments).join(", ");
      throw new AlephaError(
        `Unknown environment "${envName}". Available: ${available}`,
      );
    }

    return envConfig;
  }

  protected async resolveProjectName(
    root: string,
    configName?: string,
  ): Promise<string> {
    if (configName) {
      return configName;
    }

    try {
      const pkgPath = this.fs.join(root, "package.json");
      const pkg = await this.fs.readJsonFile<{ name?: string }>(pkgPath);
      if (pkg.name) {
        return pkg.name;
      }
    } catch {}

    throw new AlephaError(
      'Missing project name. Set "name" in alepha.config.ts or add a "name" field to package.json.',
    );
  }

  protected async resolveAppName(
    root: string,
    appPath: string,
  ): Promise<string> {
    const pkgPath = this.fs.join(root, appPath, "package.json");

    try {
      const pkg = await this.fs.readJsonFile<{ name?: string }>(pkgPath);
      if (pkg.name) {
        return this.naming.slugify(pkg.name);
      }
    } catch {}

    throw new AlephaError(
      `Missing "name" field in package.json for app at ${appPath}.`,
    );
  }
}
