import { $inject, $store, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import {
  type EnvironmentConfig,
  platformOptions,
} from "../atoms/platformOptions.ts";
import { NamingService, type Tenancy } from "./NamingService.ts";

export interface ResolvedPlatformConfig {
  project: string;
  defaultEnv: string;
  /** App tenancy mode (undefined ⇒ "none"). */
  tenancy?: Tenancy;
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
  protected readonly options = $store(platformOptions);
  protected readonly naming = $inject(NamingService);

  /**
   * Resolve and validate the full platform configuration.
   *
   * Source priority:
   *   1. `platformOptions` atom (set by `alepha.config.ts` during the
   *      configure hook) — local dev / from-source deploys.
   *   2. `dist/manifest.json` (written by `alepha build`) — pre-built
   *      deploys via Alepha Rocket or any `--prebuilt` consumer that
   *      ships only the build artifact without `alepha.config.ts`.
   */
  public async resolveConfig(root: string): Promise<ResolvedPlatformConfig> {
    if (this.options) {
      const opts = this.options;
      const project = await this.resolveProjectName(root, opts.name);
      return {
        project: this.naming.slugify(project),
        defaultEnv: opts.default ?? "production",
        tenancy: opts.tenancy,
        environments: opts.environments as Record<string, EnvironmentConfig>,
      };
    }

    // Fallback: read dist/manifest.json. Lets prebuilt artifacts deploy
    // without shipping alepha.config.ts in the tarball.
    const manifest = await this.readManifest(root);
    if (manifest) {
      return {
        project: this.naming.slugify(manifest.project),
        defaultEnv: manifest.defaultEnv ?? "production",
        tenancy: manifest.tenancy,
        environments: manifest.environments as Record<
          string,
          EnvironmentConfig
        >,
      };
    }

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

  /**
   * Read `dist/manifest.json` if present. Returns null on any error so
   * callers fall back to the strict alepha.config.ts path.
   */
  protected async readManifest(root: string): Promise<{
    project: string;
    defaultEnv?: string;
    tenancy?: Tenancy;
    environments?: Record<string, unknown>;
  } | null> {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const raw = await fs.readFile(
        path.join(root, "dist", "manifest.json"),
        "utf-8",
      );
      return JSON.parse(raw);
    } catch {
      return null;
    }
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
