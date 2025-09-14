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
			expect(logger.parseLevel("debug", "non.matching.module")).toBe("debug");
			expect(
				logger.parseLevel("specific.module:trace,warn", "non.matching.module"),
			).toBe("warn");
		});

		it("should parse simple global level", ({ expect }) => {
			const logger = createLogger();
			expect(logger.parseLevel("debug", "any.module")).toBe("debug");
			expect(logger.parseLevel("trace", "any.module")).toBe("trace");
			expect(logger.parseLevel("warn", "any.module")).toBe("warn");
			expect(logger.parseLevel("error", "any.module")).toBe("error");
			expect(logger.parseLevel("silent", "any.module")).toBe("silent");
		});

		it("should parse module-specific level with colon separator", ({
			expect,
		}) => {
			const logger = createLogger();
			expect(logger.parseLevel("test:debug,info", "test.module")).toBe("debug");
			expect(logger.parseLevel("alepha:trace,warn", "alepha.core")).toBe(
				"trace",
			);
			expect(logger.parseLevel("my.app:error,info", "my.app.service")).toBe(
				"error",
			);
		});

		it("should parse module-specific level with equals separator", ({
			expect,
		}) => {
			const logger = createLogger();
			expect(logger.parseLevel("test=debug,info", "test.module")).toBe("debug");
			expect(logger.parseLevel("alepha=trace,warn", "alepha.core")).toBe(
				"trace",
			);
			expect(logger.parseLevel("my.app=error,info", "my.app.service")).toBe(
				"error",
			);
		});

		it("should handle multiple module configurations", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha.core:trace,alepha.server:debug,my.app:error,info";

			expect(logger.parseLevel(config, "alepha.core")).toBe("trace");
			expect(logger.parseLevel(config, "alepha.server")).toBe("debug");
			expect(logger.parseLevel(config, "my.app")).toBe("error");
			expect(logger.parseLevel(config, "other.module")).toBe("info");
		});

		it("should handle semicolon separators", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha:trace;my.app:error;info";

			expect(logger.parseLevel(config, "alepha.core")).toBe("trace");
			expect(logger.parseLevel(config, "my.app")).toBe("error");
			expect(logger.parseLevel(config, "other.module")).toBe("info");
		});

		it("should use startsWith matching for modules", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha:debug,info";

			expect(logger.parseLevel(config, "alepha")).toBe("debug");
			expect(logger.parseLevel(config, "alepha.core")).toBe("debug");
			expect(logger.parseLevel(config, "alepha.server.cache")).toBe("debug");
			expect(logger.parseLevel(config, "other.alepha")).toBe("info");
		});

		it("should prioritize first matching module", ({ expect }) => {
			const logger = createLogger();
			const config = "alepha:debug,alepha.core:trace,info";

			// alepha.core matches both "alepha" and "alepha.core", but first match wins
			expect(logger.parseLevel(config, "alepha.core")).toBe("debug");
		});

		it("should handle case insensitive levels", ({ expect }) => {
			const logger = createLogger();
			expect(logger.parseLevel("DEBUG", "any.module")).toBe("debug");
			expect(logger.parseLevel("Test:TRACE,INFO", "test.module")).toBe("trace");
		});

		it("should handle whitespace around separators", ({ expect }) => {
			const logger = createLogger();
			const config = " alepha : debug , my.app : error , info ";

			expect(logger.parseLevel(config, "alepha.core")).toBe("debug");
			expect(logger.parseLevel(config, "my.app")).toBe("error");
			expect(logger.parseLevel(config, "other")).toBe("info");
		});

		it("should fall back to global level when no module match", ({
			expect,
		}) => {
			const logger = createLogger();
			const config = "specific.module:debug,trace";

			expect(logger.parseLevel(config, "other.module")).toBe("trace");
		});

		it("should handle empty parts gracefully", ({ expect }) => {
			const logger = createLogger();
			// Empty parts are now skipped gracefully
			expect(logger.parseLevel(",,debug,,", "any.module")).toBe("debug");
			expect(logger.parseLevel("alepha:trace,,info", "alepha.core")).toBe(
				"trace",
			);
			expect(logger.parseLevel("alepha:trace,,", "other.module")).toBe("info");
			expect(logger.parseLevel("   ,  , debug ,  ", "any.module")).toBe(
				"debug",
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
				"debug",
			);
			expect(logger.parseLevel("alepha.*:debug,info", "alepha.server")).toBe(
				"debug",
			);
			expect(logger.parseLevel("alepha.*:debug,info", "other.module")).toBe(
				"info",
			);

			// More specific patterns
			expect(
				logger.parseLevel("*.test:silent,*.core:trace,info", "alepha.test"),
			).toBe("silent");
			expect(
				logger.parseLevel("*.test:silent,*.core:trace,info", "my.core"),
			).toBe("trace");
			expect(
				logger.parseLevel("*.test:silent,*.core:trace,info", "other.module"),
			).toBe("info");

			// Exact prefix match still works (existing behavior)
			expect(logger.parseLevel("alepha.core:debug,info", "alepha.core")).toBe(
				"debug",
			);
			expect(
				logger.parseLevel("alepha.core:debug,info", "alepha.core.service"),
			).toBe("debug"); // startsWith behavior
		});

		it("should prioritize more specific wildcard matches", ({ expect }) => {
			const logger = createLogger();
			// First match wins, so order matters
			const config = "alepha.*:debug,alepha.core.*:trace,info";
			expect(logger.parseLevel(config, "alepha.core.service")).toBe("debug"); // matches alepha.* first

			// Reverse order
			const config2 = "alepha.core.*:trace,alepha.*:debug,info";
			expect(logger.parseLevel(config2, "alepha.core.service")).toBe("trace"); // matches alepha.core.* first
		});
	});

	describe("asLogLevel", () => {
		it("should return valid log levels", ({ expect }) => {
			const logger = createLogger();
			expect(logger.asLogLevel("trace")).toBe("trace");
			expect(logger.asLogLevel("debug")).toBe("debug");
			expect(logger.asLogLevel("info")).toBe("info");
			expect(logger.asLogLevel("warn")).toBe("warn");
			expect(logger.asLogLevel("error")).toBe("error");
			expect(logger.asLogLevel("silent")).toBe("silent");
		});

		it("should handle whitespace", ({ expect }) => {
			const logger = createLogger();
			expect(logger.asLogLevel(" debug ")).toBe("debug");
			expect(logger.asLogLevel("  trace  ")).toBe("trace");
		});

		it("should throw error for invalid levels", ({ expect }) => {
			const logger = createLogger();
			expect(() => logger.asLogLevel("invalid")).toThrow(
				"Invalid log level: invalid",
			);
			expect(() => logger.asLogLevel("")).toThrow("Invalid log level: ");
			expect(() => logger.asLogLevel("DEBUG")).toThrow(
				"Invalid log level: DEBUG",
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
			expect(logger.level).toBe("info");

			// Change state
			alepha.state.set("logLevel", "debug");
			expect(logger.level).toBe("debug");

			// Change to module-specific config
			alepha.state.set("logLevel", "test:trace,warn");
			expect(logger.level).toBe("trace");
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

			expect(level1).toBe("debug");
			expect(level2).toBe("debug");
			expect(level1).toBe(level2); // Should be same instance/value
		});
	});
});
