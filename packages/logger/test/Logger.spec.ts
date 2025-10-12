import { Alepha } from "@alepha/core";
import { describe, it } from "vitest";
import {
	LogDestinationProvider,
	LogFormatterProvider,
	MemoryDestinationProvider,
	SimpleFormatterProvider,
} from "../src";
import { Logger } from "../src/services/Logger.ts";

describe("Logger", () => {
	const createLogger = (service = "TestService", module = "test.module") => {
		const alepha = Alepha.create({
			env: { LOG_LEVEL: "info" },
		})
			.with({
				provide: LogDestinationProvider,
				use: MemoryDestinationProvider,
			})
			.with({
				provide: LogFormatterProvider,
				use: SimpleFormatterProvider,
			});

		return alepha.inject(Logger, {
			lifetime: "transient",
			args: [service, module],
		});
	};

	describe("parseLevel", () => {
		it("should return global level when no matching module found", ({
			expect,
		}) => {
			const logger = createLogger();
			// When no module-specific config matches, it falls back to global level
			expect(logger.parseLevel("debug", "non.matching.module")).toBe("DEBUG");
			expect(
				logger.parseLevel("specific.module:trace,warn", "non.matching.module"),
			).toBe("WARN");
		});

		it("should parse simple global level", ({ expect }) => {
			const logger = createLogger();
			expect(logger.parseLevel("debug", "any.module")).toBe("DEBUG");
			expect(logger.parseLevel("trace", "any.module")).toBe("TRACE");
			expect(logger.parseLevel("warn", "any.module")).toBe("WARN");
			expect(logger.parseLevel("error", "any.module")).toBe("ERROR");
			expect(logger.parseLevel("silent", "any.module")).toBe("SILENT");
		});

		it("should parse module-specific level with colon separator", ({
			expect,
		}) => {
			const logger = createLogger();
			expect(logger.parseLevel("test:debug,info", "test.module")).toBe("DEBUG");
			expect(logger.parseLevel("alepha:trace,warn", "alepha.core")).toBe(
				"TRACE",
			);
			expect(logger.parseLevel("my.app:error,info", "my.app.service")).toBe(
				"ERROR",
			);
		});

		it("should parse module-specific level with equals separator", ({
			expect,
		}) => {
			const logger = createLogger();
			expect(logger.parseLevel("test=debug,info", "test.module")).toBe("DEBUG");
			expect(logger.parseLevel("alepha=TRACE,warn", "alepha.core")).toBe(
				"TRACE",
			);
			expect(logger.parseLevel("my.app=error,info", "my.app.service")).toBe(
				"ERROR",
			);
		});

		it("should handle multiple module configurations", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha.core:trace,alepha.server:debug,my.app:error,info";

			expect(logger.parseLevel(config, "alepha.core")).toBe("TRACE");
			expect(logger.parseLevel(config, "alepha.server")).toBe("DEBUG");
			expect(logger.parseLevel(config, "my.app")).toBe("ERROR");
			expect(logger.parseLevel(config, "other.module")).toBe("INFO");
		});

		it("should handle semicolon separators", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha:trace;my.app:error;info";

			expect(logger.parseLevel(config, "alepha.core")).toBe("TRACE");
			expect(logger.parseLevel(config, "my.app")).toBe("ERROR");
			expect(logger.parseLevel(config, "other.module")).toBe("INFO");
		});

		it("should use startsWith matching for modules", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha:debug,info";

			expect(logger.parseLevel(config, "alepha")).toBe("DEBUG");
			expect(logger.parseLevel(config, "alepha.core")).toBe("DEBUG");
			expect(logger.parseLevel(config, "alepha.server.cache")).toBe("DEBUG");
			expect(logger.parseLevel(config, "other.alepha")).toBe("INFO");
		});

		it("should prioritize first matching module", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha:debug,alepha.core:trace,info";

			// alepha.core matches both "alepha" and "alepha.core", but first match wins
			expect(logger.parseLevel(config, "alepha.core")).toBe("DEBUG");
		});

		it("should handle case insensitive levels", ({ expect }) => {
			const logger = createLogger();
			expect(logger.parseLevel("DEBUG", "any.module")).toBe("DEBUG");
			expect(logger.parseLevel("Test:TRACE,INFO", "test.module")).toBe("TRACE");
		});

		it("should handle whitespace around separators", ({ expect }) => {
			const logger = createLogger();
			const config = " alepha : debug , my.app : error , info ";

			expect(logger.parseLevel(config, "alepha.core")).toBe("DEBUG");
			expect(logger.parseLevel(config, "my.app")).toBe("ERROR");
			expect(logger.parseLevel(config, "other")).toBe("INFO");
		});

		it("should fall back to global level when no module match", ({
			expect,
		}) => {
			const logger = createLogger();
			const config = "specific.module:debug,trace";

			expect(logger.parseLevel(config, "other.module")).toBe("TRACE");
		});

		it("should handle empty parts gracefully", ({ expect }) => {
			const logger = createLogger();
			// Empty parts are now skipped gracefully
			expect(logger.parseLevel(",,debug,,", "any.module")).toBe("DEBUG");
			expect(logger.parseLevel("alepha:trace,,info", "alepha.core")).toBe(
				"TRACE",
			);
			expect(logger.parseLevel("alepha:trace,,", "other.module")).toBe("INFO");
			expect(logger.parseLevel("   ,  , debug ,  ", "any.module")).toBe(
				"DEBUG",
			);
		});

		it("should provide better error messages", ({ expect }) => {
			const logger = createLogger();
			expect(() =>
				logger.parseLevel("alepha:invalid,info", "alepha.core"),
			).toThrow("Invalid log level 'invalid' for module pattern 'alepha'");
			expect(() => logger.parseLevel("badlevel", "any.module")).toThrow(
				'Invalid global log level "badlevel"',
			);
		});

		it("should support wildcard patterns", ({ expect }) => {
			const logger = createLogger();

			// Basic wildcard matching
			expect(logger.parseLevel("alepha.*:debug,info", "alepha.core")).toBe(
				"DEBUG",
			);
			expect(logger.parseLevel("alepha.*:debug,info", "alepha.server")).toBe(
				"DEBUG",
			);
			expect(logger.parseLevel("alepha.*:debug,info", "other.module")).toBe(
				"INFO",
			);

			// More specific patterns
			expect(
				logger.parseLevel("*.test:silent,*.core:trace,info", "alepha.test"),
			).toBe("SILENT");
			expect(
				logger.parseLevel("*.test:silent,*.core:trace,info", "my.core"),
			).toBe("TRACE");
			expect(
				logger.parseLevel("*.test:silent,*.core:trace,info", "other.module"),
			).toBe("INFO");

			// Exact prefix match still works (existing behavior)
			expect(logger.parseLevel("alepha.core:debug,info", "alepha.core")).toBe(
				"DEBUG",
			);
			expect(
				logger.parseLevel("alepha.core:debug,info", "alepha.core.service"),
			).toBe("DEBUG"); // startsWith behavior
		});

		it("should prioritize more specific wildcard matches", ({ expect }) => {
			const logger = createLogger();
			// First match wins, so order matters
			const config = "alepha.*:debug,alepha.core.*:trace,info";
			expect(logger.parseLevel(config, "alepha.core.service")).toBe("DEBUG"); // matches alepha.* first

			// Reverse order
			const config2 = "alepha.core.*:trace,alepha.*:debug,info";
			expect(logger.parseLevel(config2, "alepha.core.service")).toBe("TRACE"); // matches alepha.core.* first
		});
	});

	describe("asLogLevel", () => {
		it("should return valid log levels", ({ expect }) => {
			const logger = createLogger();
			expect(logger.asLogLevel("trace")).toBe("TRACE");
			expect(logger.asLogLevel("debug")).toBe("DEBUG");
			expect(logger.asLogLevel("info")).toBe("INFO");
			expect(logger.asLogLevel("warn")).toBe("WARN");
			expect(logger.asLogLevel("error")).toBe("ERROR");
			expect(logger.asLogLevel("silent")).toBe("SILENT");
		});

		it("should handle whitespace", ({ expect }) => {
			const logger = createLogger();
			expect(logger.asLogLevel(" debug ")).toBe("DEBUG");
			expect(logger.asLogLevel("  trace  ")).toBe("TRACE");
		});

		it("should throw error for invalid levels", ({ expect }) => {
			const logger = createLogger();
			expect(() => logger.asLogLevel("invalid")).toThrow(
				"Invalid log level: invalid",
			);
			expect(() => logger.asLogLevel("")).toThrow("Invalid log level: ");
			expect(() => logger.asLogLevel("DEBUqG")).toThrow(
				"Invalid log level: DEBUqG",
			);
		});
	});

	describe("level getter", () => {
		it("should update logLevel when state changes", ({ expect }) => {
			const alepha = Alepha.create({
				env: { LOG_LEVEL: "info" },
			})
				.with({
					provide: LogDestinationProvider,
					use: MemoryDestinationProvider,
				})
				.with({
					provide: LogFormatterProvider,
					use: SimpleFormatterProvider,
				});

			const logger = alepha.inject(Logger, {
				lifetime: "transient",
				args: ["TestService", "test.module"],
			});

			// Initial state
			expect(logger.level).toBe("INFO");

			// Change state
			alepha.state.set("logLevel", "debug");
			expect(logger.level).toBe("DEBUG");

			// Change to module-specific config
			alepha.state.set("logLevel", "test:trace,warn");
			expect(logger.level).toBe("TRACE");
		});

		it("should cache parsed level until state changes", ({ expect }) => {
			const alepha = Alepha.create({
				env: { LOG_LEVEL: "info" },
			})
				.with({
					provide: LogDestinationProvider,
					use: MemoryDestinationProvider,
				})
				.with({
					provide: LogFormatterProvider,
					use: SimpleFormatterProvider,
				});

			const logger = alepha.inject(Logger, {
				lifetime: "transient",
				args: ["TestService", "test.module"],
			});

			alepha.state.set("logLevel", "test:debug,info");
			const level1 = logger.level;
			const level2 = logger.level;

			expect(level1).toBe("DEBUG");
			expect(level2).toBe("DEBUG");
			expect(level1).toBe(level2); // Should be same instance/value
		});
	});
});
