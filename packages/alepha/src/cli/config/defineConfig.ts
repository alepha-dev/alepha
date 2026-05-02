import type { Alepha, Service } from "alepha";
import {
  type AppEntryOptions,
  appEntryOptions,
  type BuildOptions,
  buildOptions,
  type DevOptions,
  devOptions,
} from "alepha/cli";

// ---------------------------------------------------------------------------------------------------------------------

export interface AlephaCliConfig {
  /**
   * Override entry paths.
   */
  entry?: AppEntryOptions;

  /**
   * Register more services to the Alepha CLI (enhancements, commands, etc.).
   */
  services?: Array<Service>;

  /**
   * @alias services Register more services to the Alepha CLI (enhancements, commands, etc.).
   */
  plugins?: Array<Service>;

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

// ---------------------------------------------------------------------------------------------------------------------

export const defineConfig = (config: AlephaCliConfig) => {
  return (alepha: Alepha) => {
    if (config.services) {
      for (const it of config.services) {
        alepha.with(it);
      }
    }

    if (config.plugins) {
      for (const it of config.plugins) {
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

    return {};
  };
};
