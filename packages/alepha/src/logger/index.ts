import { $module, type Static, z } from "alepha";
import { $logger } from "./primitives/$logger.ts";
import { CliFormatterProvider } from "./providers/CliFormatterProvider.ts";
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
export * from "./providers/CliFormatterProvider.ts";
export * from "./providers/ConsoleColorProvider.ts";
export * from "./providers/ConsoleDestinationProvider.ts";
export * from "./providers/JsonFormatterProvider.ts";
export * from "./providers/LogDestinationProvider.ts";
export * from "./providers/LogFormatterProvider.ts";
export * from "./providers/MemoryDestinationProvider.ts";
export * from "./providers/PrettyFormatterProvider.ts";
export * from "./providers/RawFormatterProvider.ts";
export * from "./schemas/logEntrySchema.ts";
export * from "./services/Logger.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Configurable logging with multiple outputs.
 *
 * **Features:**
 * - Global logger access
 * - JSON format
 * - Pretty colored output
 * - Compact CLI format
 * - Raw text format
 * - Console destination
 * - Memory destination (for devtools)
 * - Custom handlers
 * - Configuration via `LOG_LEVEL`, `LOG_FORMAT`, and `DEBUG`
 *
 * @module alepha.logger
 */
export const AlephaLogger = $module({
  name: "alepha.logger",
  primitives: [$logger],
  services: [Logger, ConsoleColorProvider],
  variants: [
    ConsoleDestinationProvider,
    MemoryDestinationProvider,
    JsonFormatterProvider,
    PrettyFormatterProvider,
    RawFormatterProvider,
    CliFormatterProvider,
  ],
  register: (alepha) => {
    const env = alepha.parseEnv(envSchema);

    // Support DEBUG env var (debug package convention) as shorthand for LOG_LEVEL/LOG_FORMAT.
    // DEBUG=1 → LOG_LEVEL=trace LOG_FORMAT=pretty
    // DEBUG=alepha:* → LOG_LEVEL=alepha.*:debug,info LOG_FORMAT=pretty
    let logLevel = env.LOG_LEVEL;
    let logFormat = env.LOG_FORMAT;
    if (env.DEBUG) {
      if (env.DEBUG === "1" || env.DEBUG === "true") {
        logLevel ??= "trace";
      } else {
        const patterns = env.DEBUG.split(",")
          .map((p) => p.trim().replaceAll(":", "."))
          .filter(Boolean);
        logLevel ??= `${patterns.map((p) => `${p}:debug`).join(",")},info`;
      }
      logFormat ??= "pretty";
    }

    const getLogDestinationProvider = () => {
      // in test mode, if no LOG_LEVEL is set, use MemoryDestinationProvider to capture logs for inspection.
      // logs will be printed to console only if the test fails.
      if (alepha.isTest() && !logLevel) {
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
      if (logFormat) {
        if (logFormat === "json") {
          return JsonFormatterProvider;
        }
        if (logFormat === "raw") {
          return RawFormatterProvider;
        }
        if (logFormat === "cli") {
          return CliFormatterProvider;
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
      logLevel ??
        (alepha.isTest()
          ? "trace"
          : alepha.isProduction() && alepha.isBrowser()
            ? "warn"
            : "info"),
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = z.object({
  /**
   * Enable debug logging for specific modules using the `debug` package convention.
   *
   * @example
   * DEBUG=1 # Shorthand for LOG_LEVEL=trace LOG_FORMAT=pretty
   * DEBUG=alepha:* # Enable debug logging for all alepha modules
   * DEBUG=alepha:orm* # Enable debug logging for alepha.orm and its submodules
   * DEBUG=* # Enable debug logging for all modules
   */
  DEBUG: z
    .text({
      description:
        "Enable debug logging for specific modules using the debug package convention. Example: DEBUG=alepha:*",
    })
    .optional(),

  /**
   * Default log level for the application.
   *
   * Default by environment:
   * - dev = info
   * - prod = info (server) / warn (browser)
   * - test = trace (buffered in memory, printed on failure)
   *
   * Levels are: "trace" | "debug" | "info" | "warn" | "error" | "silent"
   *
   * Level can be set for a specific module:
   *
   * @example
   * LOG_LEVEL=my.module.name:debug,info # Set debug level for my.module.name and info for all other modules
   * LOG_LEVEL=alepha:trace, info # Set trace level for all alepha modules and info for all other modules
   */
  LOG_LEVEL: z
    .text({
      description: `Application log level on startup.
Levels are: trace, debug, info, warn, error, silent
Level can be set for a specific module:
"my.module.name:debug,info" -> Set debug level for my.module.name and info for all other modules
"alepha:trace,info" -> Set trace level for all alepha modules and info for all other modules`,
      lowercase: true,
    })
    .optional(),

  /**
   * Built-in log formats.
   * - "json" - JSON format, useful for structured logging and log aggregation. {@link JsonFormatterProvider}
   * - "pretty" - Full text format, human-readable, with colors and module/context. {@link PrettyFormatterProvider}
   * - "cli" - Compact format for CLI sessions: time, level initial, message, json. {@link CliFormatterProvider}
   * - "raw" - Raw format, no formatting, just the message (best for piping). {@link RawFormatterProvider}
   */
  LOG_FORMAT: z
    .enum(["json", "pretty", "raw", "cli"])
    .meta({ lowercase: true })
    .describe("Default log format for the application.")
    .optional(),
});

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  export interface Env extends Partial<Static<typeof envSchema>> {}

  export interface State {
    /**
     * Current log level for the application or specific modules.
     */
    "alepha.logger.level"?: string;

    /**
     * Runtime override for the log format (`json` | `pretty` | `raw`).
     *
     * Unset → the formatter chosen at register time from `LOG_FORMAT`
     * (honoring any custom `LogFormatterProvider` substitution) is used.
     * When set, it overrides both the active formatter and the CLI's
     * dynamic/"stylish" task UI (which is enabled only for `raw`). Set it
     * to flip output at runtime — e.g. the CLI `--verbose` flag forces
     * `pretty`.
     */
    "alepha.logger.format"?: string;
  }

  export interface Hooks {
    log: {
      message?: string;
      entry: LogEntry;
    };
  }
}
