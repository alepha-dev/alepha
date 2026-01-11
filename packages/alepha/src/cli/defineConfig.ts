import type { Alepha } from "alepha";
import type { CommandPrimitive } from "alepha/command";
import { type BuildOptions, buildOptions } from "./atoms/buildOptions.ts";

export interface AlephaCliConfig {
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

    return {
      ...config.commands,
    };
  };
};

/**
 * @alias defineConfig
 */
export const defineAlephaConfig = defineConfig;
