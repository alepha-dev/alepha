import { $module, type Static, t } from "alepha";
import { $logger } from "./primitives/$logger.ts";
import { ConsoleDestinationProvider } from "./providers/ConsoleDestinationProvider.ts";
import { JsonFormatterProvider } from "./providers/JsonFormatterProvider.ts";
import { LogDestinationProvider } from "./providers/LogDestinationProvider.ts";
import { LogFormatterProvider } from "./providers/LogFormatterProvider.ts";
import { MemoryDestinationProvider } from "./providers/MemoryDestinationProvider.ts";
import { RawFormatterProvider } from "./providers/RawFormatterProvider.ts";
import { SimpleFormatterProvider } from "./providers/SimpleFormatterProvider.ts";
import type { LogEntry } from "./schemas/logEntrySchema.ts";
import { Logger } from "./services/Logger.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$logger.ts";
export * from "./providers/ConsoleColorProvider.ts";
export * from "./providers/ConsoleDestinationProvider.ts";
export * from "./providers/JsonFormatterProvider.ts";
export * from "./providers/LogDestinationProvider.ts";
export * from "./providers/LogFormatterProvider.ts";
export * from "./providers/MemoryDestinationProvider.ts";
export * from "./providers/SimpleFormatterProvider.ts";
export * from "./schemas/logEntrySchema.ts";
export * from "./services/Logger.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Minimalist logger module for Alepha.
 *
 * It offers a global logger interface (info, warn, ...) via the `$logger` primitive.
 *
 * ```ts
 * import { $logger } from "alepha/logger";
 *
 * class App {
 *   log = $logger();
 * }
 * ```
 *
 * ### Formatting and Destinations
 *
 * `AlephaLogger` is **extensible**, destinations and formatters can be added or replaced.
 *
 * Default log destinations are:
 * - ConsoleDestinationProvider: logs to the console.
 * - MemoryDestinationProvider: stores logs in memory for later retrieval.
 *
 * Default log formatters are:
 * - JsonFormatterProvider: formats logs as JSON.
 * - SimpleFormatterProvider: formats logs as simple text (with colors when possible).
 * - RawFormatterProvider: formats logs as raw text without any formatting.
 *
 * ### Event Emission
 *
 * The logger emits 'log' events that can be listened to by external code, allowing for custom log processing and destinations.
 *
 * ```ts
 * class CustomDestination {
 *   onLog = $hook({
 *     on: "log",
 *     handler: (ev) => {
 *       // ev.message (formatted message)
 *       // ev.entry (level, raw message, ...)
 *     }
 *   });
 * }
 * ```
 *
 * ### Log Level
 *
 * You can configure the log level and format via environment variables:
 *
 * - `LOG_LEVEL`: Sets the default log level for the application.
 * - `LOG_FORMAT`: Sets the default log format for the application.
 *
 * ```bash
 * LOG_LEVEL=debug LOG_FORMAT=json node src/index.ts
 * ```
 *
 * Log level is also available in the state as `logLevel`, which can be used to dynamically change the log level at runtime.
 * ```ts
 * alepha.state.set("alepha.logger.level", "debug");
 * ```
 *
 * Log level is $module aware, meaning you can set different log levels for different modules.
 *
 * **Module-specific configuration:**
 * - `LOG_LEVEL=my.module.name:debug,info` - debug for `my.module.name` (and submodules), info for others
 * - `LOG_LEVEL=alepha:trace,my.app:error,info` - trace for alepha modules, error for my.app modules, info for others
 *
 * **Wildcard patterns (NEW):**
 * - `LOG_LEVEL=alepha.*:debug,info` - debug for all alepha submodules
 * - `LOG_LEVEL=*.test:silent,*.core:trace,info` - silent for test modules, trace for core modules
 */
export const AlephaLogger = $module({
  name: "alepha.logger",
  primitives: [$logger],
  services: [
    Logger,
    ConsoleDestinationProvider,
    MemoryDestinationProvider,
    JsonFormatterProvider,
    SimpleFormatterProvider,
    RawFormatterProvider,
  ],
  register: (alepha) => {
    const env = alepha.parseEnv(envSchema);

    const getLogDestinationProvider = () => {
      // in test mode, if no LOG_LEVEL is set, use MemoryDestinationProvider to capture logs for inspection.
      // logs will be printed to console only if the test fails.
      if (alepha.isTest() && !env.LOG_LEVEL) {
        const printOnError = (ev: any) => {
          if (ev.task?.result?.state === "fail") {
            const output = alepha.inject(MemoryDestinationProvider);
            for (const log of output.logs) {
              console.log(log.formatted);
            }
          }
        };

        try {
          alepha.store.get("alepha.test.afterEach")?.(printOnError);
          alepha.store.get("alepha.test.onTestFinished")?.(printOnError);
        } catch {
          // ignore
        }

        return MemoryDestinationProvider;
      }

      return ConsoleDestinationProvider;
    };

    const getLogFormatterProvider = () => {
      if (env.LOG_FORMAT) {
        if (env.LOG_FORMAT === "json") {
          return JsonFormatterProvider;
        }
        if (env.LOG_FORMAT === "raw") {
          return RawFormatterProvider;
        }
        return SimpleFormatterProvider;
      }

      if (alepha.isProduction() && !alepha.isBrowser()) {
        return JsonFormatterProvider;
      }

      return SimpleFormatterProvider;
    };

    alepha.with({
      optional: true,
      provide: LogDestinationProvider,
      use: getLogDestinationProvider(),
    });

    alepha.with({
      optional: true,
      provide: LogFormatterProvider,
      use: getLogFormatterProvider(),
    });

    alepha.store.set(
      "alepha.logger",
      alepha.inject(Logger, {
        lifetime: "transient",
        args: ["Alepha", "alepha.core"],
      }),
    );

    alepha.store.set(
      "alepha.logger.level",
      env.LOG_LEVEL ?? (alepha.isTest() ? "trace" : "info"),
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  /**
   * Default log level for the application.
   *
   * Default by environment:
   * - dev = info
   * - prod = info
   * - test = error
   *
   * Levels are: "trace" | "debug" | "info" | "warn" | "error" | "silent"
   *
   * Level can be set for a specific module:
   *
   * @example
   * LOG_LEVEL=my.module.name:debug,info # Set debug level for my.module.name and info for all other modules
   * LOG_LEVEL=alepha:trace, info # Set trace level for all alepha modules and info for all other modules
   */
  LOG_LEVEL: t.optional(t.text({ lowercase: true })),

  /**
   * Built-in log formats.
   * - "json" - JSON format, useful for structured logging and log aggregation. {@link JsonFormatterProvider}
   * - "pretty" - Simple text format, human-readable, with colors. {@link SimpleFormatterProvider}
   * - "raw" - Raw format, no formatting, just the message.  {@link RawFormatterProvider}
   */
  LOG_FORMAT: t.optional(
    t.enum(["json", "pretty", "raw"], { lowercase: true }),
  ),
});

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  export interface Env extends Partial<Static<typeof envSchema>> {}

  export interface State {
    /**
     * Current log level for the application or specific modules.
     */
    "alepha.logger.level"?: string;
  }

  export interface Hooks {
    log: {
      message?: string;
      entry: LogEntry;
    };
  }
}
