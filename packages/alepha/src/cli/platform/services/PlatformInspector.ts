import { $inject, $state, Alepha, AlephaError } from "alepha";
import { Asker } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import {
  type EnvironmentConfig,
  platformOptions,
} from "../atoms/platformOptions.ts";
import { NamingService } from "./NamingService.ts";

export interface ResolvedPlatformConfig {
  project: string;
  defaultEnv: string;
  environments: Record<string, EnvironmentConfig>;
}

/**
 * Reads platform config and resolves project topology.
 *
 * Validates project name and environment configuration. Does NOT
 * introspect app code for resources — that happens at deploy time via
 * ViteBuildProvider.
 *
 * Each app self-declares its platform topology via its own
 * `alepha.config.ts`. Run `alepha platform <op>` from the app's
 * directory; no monorepo-root orchestration here.
 */
export class PlatformInspector {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly asker = $inject(Asker);
  protected readonly options = $state(platformOptions);
  protected readonly naming = $inject(NamingService);

  /**
   * Resolve and validate the full platform configuration.
   */
  public async resolveConfig(root: string): Promise<ResolvedPlatformConfig> {
    if (!this.options) {
      this.log.warn(` alepha.config.ts not found or missing platform config.

Please add a "platform" section to alepha.config.ts:

export default defineConfig({
  platform: {
    environments: {
      production: { adapter: "cloudflare" },
    },
  },
});
        `);
      throw new AlephaError("Missing platform configuration.");
    }

    const opts = this.options;
    const project = await this.resolveProjectName(root, opts.name);

    return {
      project: this.naming.slugify(project),
      defaultEnv: opts.default ?? "production",
      environments: opts.environments as Record<string, EnvironmentConfig>,
    };
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
}
