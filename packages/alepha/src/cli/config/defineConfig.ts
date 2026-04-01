import type { Alepha } from "alepha";
import {
  type AppEntryOptions,
  appEntryOptions,
  type BuildOptions,
  buildOptions,
  type DevOptions,
  devOptions,
} from "alepha/cli";
import { type DevtoolsOptions, devtoolsOptions } from "alepha/cli/devtools";
import { type PlatformOptions, platformOptions } from "alepha/cli/platform";
import { type VendorOptions, vendorOptions } from "alepha/cli/vendor";
import type { CommandPrimitive } from "alepha/command";

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
   * Configure devtools plugin.
   */
  devtools?: DevtoolsOptions;

  /**
   * Environment variables to set before running commands.
   *
   * Always use .env files by default, this is only for dynamic values.
   */
  env?: Record<string, unknown>;

  /**
   * Platform deployment configuration.
   */
  platform?: PlatformOptions;

  /**
   * Vendor synchronization configuration.
   */
  vendor?: VendorOptions;
}

export type AlephaCliConfigFn = (alepha: Alepha) => AlephaCliConfig;

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

    if (config.platform) {
      alepha.set(platformOptions, config.platform);
    }

    if (config.devtools) {
      alepha.set(devtoolsOptions, config.devtools);
    }

    if (config.vendor) {
      alepha.set(vendorOptions, config.vendor);
    }

    return {
      ...config.commands,
    };
  };
};
