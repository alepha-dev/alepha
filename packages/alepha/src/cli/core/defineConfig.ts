import type { Alepha } from "alepha";
import type { CommandPrimitive } from "alepha/command";
import {
  type AppEntryOptions,
  appEntryOptions,
} from "./atoms/appEntryOptions.ts";
import { type BuildOptions, buildOptions } from "./atoms/buildOptions.ts";
import { type DevOptions, devOptions } from "./atoms/devOptions.ts";

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
   * Environment variables to set before running commands.
   *
   * Always use .env files by default, this is only for dynamic values.
   */
  env?: Record<string, unknown>;
}

export type AlephaCliConfigFn = (alepha: Alepha) => AlephaCliConfig;

type ConfigProcessor = (alepha: Alepha, config: AlephaCliConfig) => void;

const configProcessors: ConfigProcessor[] = [];

/**
 * Register a processor that runs during config resolution.
 *
 * Used by submodules (e.g. platform) to handle their own config keys
 * without core needing to know about them.
 */
export function registerConfigProcessor(processor: ConfigProcessor) {
  configProcessors.push(processor);
}

// ---------------------------------------------------------------------------------------------------------------------

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

    for (const processor of configProcessors) {
      processor(alepha, config);
    }

    return {
      ...config.commands,
    };
  };
};
