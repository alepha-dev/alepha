import type { Alepha } from "alepha";
import type { CommandPrimitive } from "alepha/command";
import {
  type AppEntryOptions,
  appEntryOptions,
} from "./atoms/appEntryOptions.ts";
import { type BuildOptions, buildOptions } from "./atoms/buildOptions.ts";
import { type DevOptions, devOptions } from "./atoms/devOptions.ts";
import { platformOptions } from "./atoms/platformOptions.ts";

export interface AlephaCliConfig {
  entry?: AppEntryOptions;
  /**
   * Add custom commands to the Alepha CLI.
   *
   * You can override 'deploy', 'build', 'dev', 'start' commands this way.
   * But you can also add your own commands and run them via `alepha <command>`.
   */
  commands?: Record<string, CommandPrimitive>;

  /**
   * Register more services to the Alepha CLI (enhancements, commands, etc.).
   */
  services?: Array<any>;

  /**
   * Configure Alepha build command.
   */
  build?: BuildOptions;

  /**
   * Configure Alepha dev command.
   */
  dev?: DevOptions;

  /**
   * Project name override. Defaults to root package.json "name".
   */
  name?: string;

  /**
   * Monorepo app paths relative to root. Omit for standalone apps.
   */
  apps?: string[];

  /**
   * Platform deployment configuration.
   */
  platform?: {
    default?: string;
    environments: Record<
      string,
      {
        adapter: "cloudflare" | "docker-compose" | "aks";
        domain?: string;
        vars?: Record<string, string>;
      }
    >;
  };

  /**
   * Environment variables to set before running commands.
   *
   * Always use .env files by default, this is only for dynamic values.
   */
  env?: Record<string, unknown>;
}

export type AlephaCliConfigFn = (alepha: Alepha) => AlephaCliConfig;

export const defineConfig = (
  runConfig: AlephaCliConfig | AlephaCliConfigFn,
) => {
  return (alepha: Alepha) => {
    const config =
      typeof runConfig === "function" ? runConfig(alepha) : runConfig;

    if (config.services) {
      for (const it of config.services) {
        alepha.with(it);
      }
    }

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        process.env[key] = String(value);
      }
    }

    if (config.build) {
      alepha.set(buildOptions, config.build);
    }

    if (config.dev) {
      alepha.set(devOptions, config.dev);
    }

    if (config.entry) {
      alepha.set(appEntryOptions, config.entry);
    }

    if (config.platform || config.name || config.apps) {
      alepha.set(platformOptions, {
        name: config.name,
        apps: config.apps,
        platform: config.platform,
      });
    }

    return {
      ...config.commands,
    };
  };
};

/**
 * @alias defineConfig
 */
export const defineAlephaConfig = defineConfig;
