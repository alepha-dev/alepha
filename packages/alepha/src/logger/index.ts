import { $module, type Static, t } from "alepha";
import { $logger } from "./primitives/$logger.ts";
import { ConsoleColorProvider } from "./providers/ConsoleColorProvider.ts";
import { ConsoleDestinationProvider } from "./providers/ConsoleDestinationProvider.ts";
import { JsonFormatterProvider } from "./providers/JsonFormatterProvider.ts";
import { LogDestinationProvider } from "./providers/LogDestinationProvider.ts";
import { LogFormatterProvider } from "./providers/LogFormatterProvider.ts";
import { MemoryDestinationProvider } from "./providers/MemoryDestinationProvider.ts";
import { PrettyFormatterProvider } from "./providers/PrettyFormatterProvider.ts";
import { RawFormatterProvider } from "./providers/RawFormatterProvider.ts";
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
export * from "./providers/PrettyFormatterProvider.ts";
export * from "./schemas/logEntrySchema.ts";
export * from "./services/Logger.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.5.0 | node, bun, workerd, browser, expo|
 *
 * Configurable logging with multiple outputs.
 *
 * **Features:**
 * - Global logger access
 * - JSON format
 * - Pretty colored output
 * - Raw text format
 * - Console destination
 * - Memory destination (for devtools)
 * - Custom handlers
 * - Configuration via `LOG_LEVEL` and `LOG_FORMAT`
 *
 * @module alepha.logger
 */
export const AlephaLogger = $module({
  name: "alepha.logger",
  primitives: [$logger],
  services: [
    Logger,
    ConsoleDestinationProvider,
    MemoryDestinationProvider,
    JsonFormatterProvider,
    PrettyFormatterProvider,
    RawFormatterProvider,
    ConsoleColorProvider,
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
        return PrettyFormatterProvider;
      }

      if (alepha.isProduction() && !alepha.isBrowser()) {
        return JsonFormatterProvider;
      }

      return PrettyFormatterProvider;
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
  LOG_LEVEL: t.optional(
    t.text({
      description: `Application log level on startup.
Levels are: trace, debug, info, warn, error, silent
Level can be set for a specific module:
"my.module.name:debug,info" -> Set debug level for my.module.name and info for all other modules
"alepha:trace,info" -> Set trace level for all alepha modules and info for all other modules`,
      lowercase: true,
    }),
  ),

  /**
   * Built-in log formats.
   * - "json" - JSON format, useful for structured logging and log aggregation. {@link JsonFormatterProvider}
   * - "pretty" - Simple text format, human-readable, with colors. {@link PrettyFormatterProvider}
   * - "raw" - Raw format, no formatting, just the message. {@link RawFormatterProvider}
   */
  LOG_FORMAT: t.optional(
    t.enum(["json", "pretty", "raw"], {
      description: "Default log format for the application.",
      lowercase: true,
    }),
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
