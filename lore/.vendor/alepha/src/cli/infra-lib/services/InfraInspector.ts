import { $inject, $store, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type { EnvironmentDescriptor } from "../adapters/InfraAdapter.ts";
import { infraOptions } from "../atoms/infraOptions.ts";
import { NamingService } from "./NamingService.ts";

export interface ResolvedInfraConfig {
  /**
   * The prefix every resource is named after: the slugified app name, behind
   * `infra({ project })` when one is set (`alepha-docs`).
   */
  project: string;
  defaultEnv: string;
  environments: Record<string, EnvironmentDescriptor>;
}

/**
 * Reads platform config and resolves project topology.
 *
 * Validates project name and environment configuration. Does NOT
 * introspect app code for resources  -  that happens at deploy time via
 * ViteBuildProvider.
 *
 * Each app self-declares its platform topology via its own
 * `alepha.config.ts`. Run `alepha infra <op>` from the app's
 * directory; no monorepo-root orchestration here.
 */
export class InfraInspector {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly options = $store(infraOptions);
  protected readonly naming = $inject(NamingService);

  /**
   * Resolve and validate the full platform configuration.
   *
   * Source priority:
   *   1. `infraOptions` atom (set by `alepha.config.ts` during the
   *      configure hook)  -  local dev / from-source deploys.
   *   2. `dist/manifest.json` (written by `alepha build`)  -  pre-built
   *      deploys via Alepha Rocket or any `--prebuilt` consumer that
   *      ships only the build artifact without `alepha.config.ts`.
   */
  public async resolveConfig(root: string): Promise<ResolvedInfraConfig> {
    if (this.options) {
      const opts = this.options;
      if (Object.keys(opts.environments).length === 0)
        this.missingConfiguration();
      const app = await this.resolveProjectName(root, opts.name);
      return {
        project: this.naming.slugify(
          opts.project ? `${opts.project}-${app}` : app,
        ),
        defaultEnv: opts.default ?? "production",
        environments: opts.environments,
      };
    }

    // Fallback: read dist/manifest.json, for the project name of a prebuilt
    // artifact shipped without alepha.config.ts. It carries no environments:
    // no build writes them, and an environment names an adapter CLASS, which
    // cannot be serialised into a manifest anyway. A caller that deploys from
    // one sets `infraOptions` itself, as Lore's `DeployRunner` does.
    const manifest = await this.readManifest(root);
    if (manifest) {
      return {
        project: this.naming.slugify(manifest.project),
        defaultEnv: manifest.defaultEnv ?? "production",
        environments: {},
      };
    }

    return this.missingConfiguration();
  }

  /**
   * Canonical guidance when an operation has no explicit environment map.
   */
  public missingConfiguration(): never {
    throw new AlephaError(`Missing infra configuration. Register explicit environments in alepha.config.ts:

import { defineConfig } from "alepha/cli/config";
import { cloudflare, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [infra({ environments: { production: cloudflare() } })],
});`);
  }

  /**
   * Read `dist/manifest.json` if present. Returns null on any error so
   * callers fall back to the strict alepha.config.ts path.
   */
  protected async readManifest(root: string): Promise<{
    project: string;
    defaultEnv?: string;
  } | null> {
    try {
      const raw = await this.fs.readTextFile(
        this.fs.join(root, "dist", "manifest.json"),
      );
      const manifest = JSON.parse(raw);
      return typeof manifest?.project === "string" ? manifest : null;
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
  ): Promise<EnvironmentDescriptor> {
    const config = await this.resolveConfig(root);
    if (Object.keys(config.environments).length === 0)
      this.missingConfiguration();
    const descriptor = config.environments[envName];

    if (!descriptor) {
      const available = Object.keys(config.environments).join(", ");
      throw new AlephaError(
        `Unknown environment "${envName}". Available: ${available}`,
      );
    }

    return descriptor;
  }

  /**
   * The `domain` an environment's options carry, when its adapter takes one.
   *
   * Read structurally rather than typed: `domain` is on the options every
   * built-in adapter that attaches a host shares, and a descriptor from
   * another factory (`lore()`) has none.
   */
  public domainOf(
    descriptor: EnvironmentDescriptor | undefined,
  ): string | undefined {
    const domain = (descriptor?.options as { domain?: unknown } | undefined)
      ?.domain;
    return typeof domain === "string" && domain ? domain : undefined;
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
