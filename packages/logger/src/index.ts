import { $module, type Static, t } from "@alepha/core";
import { $logger } from "./descriptors/$logger.ts";
import { ConsoleDestinationProvider } from "./providers/ConsoleDestinationProvider.ts";
import { JsonFormatterProvider } from "./providers/JsonFormatterProvider.ts";
import { LogDestinationProvider } from "./providers/LogDestinationProvider.ts";
import { LogFormatterProvider } from "./providers/LogFormatterProvider.ts";
import { MemoryDestinationProvider } from "./providers/MemoryDestinationProvider.ts";
import { RawFormatterProvider } from "./providers/RawFormatterProvider.ts";
import { SimpleFormatterProvider } from "./providers/SimpleFormatterProvider.ts";
import { Logger } from "./services/Logger.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$logger.ts";
export * from "./providers/ConsoleColorProvider.ts";
export * from "./providers/ConsoleDestinationProvider.ts";
export * from "./providers/JsonFormatterProvider.ts";
export * from "./providers/LogDestinationProvider.ts";
export * from "./providers/LogFormatterProvider.ts";
export * from "./providers/MemoryDestinationProvider.ts";
export * from "./providers/SimpleFormatterProvider.ts";
export * from "./services/Logger.ts";

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
	LOG_LEVEL: t.optional(t.string()),

	/**
	 * Built-in log formats.
	 * - "json" - JSON format, useful for structured logging and log aggregation. {@link JsonFormatterProvider}
	 * - "text" - Simple text format, human-readable, with colors. {@link SimpleFormatterProvider}
	 * - "raw" - Raw format, no formatting, just the message.  {@link RawFormatterProvider}
	 */
	LOG_FORMAT: t.optional(t.enum(["json", "text", "raw"])),
});

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	export interface Env extends Partial<Static<typeof envSchema>> {}

	export interface State {
		logLevel?: string;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Minimalist logger module for Alepha.
 *
 * It offers a global logger interface (info, warn, ...) via the `$logger` descriptor.
 *
 * ```ts
 * import { $logger } from "@alepha/logger";
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
 * alepha.state("logLevel", "debug");
 * ```
 *
 * Log level is $module aware, meaning you can set different log levels for different modules.
 * For example, you can set `LOG_LEVEL=my.module.name:debug,info` to set the log level to debug for `my.module.name` and info for all other modules.
 */
export const AlephaLogger = $module({
	name: "alepha.logger",
	descriptors: [$logger],
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

			if (alepha.isProduction()) {
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

		alepha.state(
			"log",
			alepha.inject(Logger, {
				skipCache: true,
				skipRegistration: true,
				args: ["Alepha", "alepha.core"],
			}),
		);

		alepha.state(
			"logLevel",
			env.LOG_LEVEL ?? (alepha.isTest() ? "error" : "info"),
		);
	},
});
