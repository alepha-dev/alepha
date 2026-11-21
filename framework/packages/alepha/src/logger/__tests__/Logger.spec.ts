import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  JsonFormatterProvider,
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
  PrettyFormatterProvider,
  RawFormatterProvider,
} from "../index.ts";
import { Logger } from "../services/Logger.ts";

/**
 * Exposes the protected `formatter` getter so the runtime format override
 * can be asserted by provider identity.
 */
class TestLogger extends Logger {
  public get activeFormatter() {
    return this.formatter;
  }
}

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
        use: PrettyFormatterProvider,
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

    it("should give a wildcard pattern to the first match, not the most specific", ({
      expect,
    }) => {
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
          use: PrettyFormatterProvider,
        });

      const logger = alepha.inject(Logger, {
        lifetime: "transient",
        args: ["TestService", "test.module"],
      });

      // Initial state
      expect(logger.level).toBe("INFO");

      // Change state
      alepha.store.set("alepha.logger.level", "debug");
      expect(logger.level).toBe("DEBUG");

      // Change to module-specific config
      alepha.store.set("alepha.logger.level", "test:trace,warn");
      expect(logger.level).toBe("TRACE");
    });

    const createLevelApp = (level: string) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: level },
      })
        .with({
          provide: LogDestinationProvider,
          use: MemoryDestinationProvider,
        })
        .with({
          provide: LogFormatterProvider,
          use: PrettyFormatterProvider,
        });

      const logger = (module: string) =>
        alepha.inject(Logger, {
          lifetime: "transient",
          args: ["TestService", module],
        });

      const reports = () =>
        alepha
          .inject(MemoryDestinationProvider)
          .logs.filter((log) => log.message.includes("Invalid"))
          .map((log) => `${log.level} ${log.message}`);

      const setLevel = (value: string) =>
        alepha.store.set("alepha.logger.level", value);

      return { alepha, logger, reports, setLevel };
    };

    it("keeps the level in force when the global level becomes invalid, and never throws", ({
      expect,
    }) => {
      const { alepha, logger, reports, setLevel } = createLevelApp(
        "test.module:debug,warn",
      );
      const named = logger("test.module");
      const other = logger("other.module");
      expect(named.level).toBe("DEBUG");
      expect(other.level).toBe("WARN");

      setLevel("verbose");

      expect(named.level).toBe("DEBUG");
      expect(named.level).toBe("DEBUG");
      expect(other.level).toBe("WARN");
      expect(() => named.debug("still logged")).not.toThrow();
      expect(
        alepha
          .inject(MemoryDestinationProvider)
          .logs.some((entry) => entry.message === "still logged"),
      ).toBe(true);

      // A valid level afterwards is applied.
      setLevel("error");
      expect(named.level).toBe("ERROR");
      expect(other.level).toBe("ERROR");
      expect(reports()).toEqual([
        'WARN Invalid global log level "verbose": the last valid level, "test.module:debug,warn", applies',
      ]);
    });

    it("gives a logger created after an invalid level the level in force, not the default", ({
      expect,
    }) => {
      const { logger, setLevel } = createLevelApp("test.module:trace,error");
      expect(logger("test.module").level).toBe("TRACE");

      setLevel("verbose");

      expect(logger("test.module").level).toBe("TRACE");
      expect(logger("other.module").level).toBe("ERROR");
    });

    it("reports a refused value once for the container, and again once it is refused anew", ({
      expect,
    }) => {
      const { logger, reports, setLevel } = createLevelApp("info");
      const first = logger("test.module");
      const second = logger("test.other");
      expect(first.level).toBe("INFO");
      expect(second.level).toBe("INFO");

      setLevel("verbose");
      first.info("one");
      first.info("two");
      second.info("three");
      logger("test.third").info("four");
      expect(reports()).toHaveLength(1);

      setLevel("info");
      first.info("five");
      second.info("six");
      setLevel("verbose");
      first.info("seven");
      second.info("eight");
      expect(reports()).toHaveLength(2);
    });

    it("reports each invalid part once, whatever the number of loggers it names", ({
      expect,
    }) => {
      const { logger, reports, setLevel } = createLevelApp("info");
      const loggers = ["a.one", "a.two", "b.one", "b.two", "c.one"].map(
        (module) => logger(module),
      );
      for (const each of loggers) {
        expect(each.level).toBe("INFO");
      }

      setLevel("a:verbose,b:loud,warn");

      for (const each of loggers) {
        each.warn("line");
      }
      expect(reports()).toEqual([
        "WARN Invalid log level 'verbose' for module pattern 'a': its modules follow the global level",
        "WARN Invalid log level 'loud' for module pattern 'b': its modules follow the global level",
      ]);
    });

    it("gives the modules an invalid part names the global level of the same string", ({
      expect,
    }) => {
      const { logger, setLevel } = createLevelApp("info");
      const named = logger("test.module");
      const other = logger("other.module");
      expect(named.level).toBe("INFO");

      setLevel("test.module:verbose,other:trace,debug");

      expect(named.level).toBe("DEBUG");
      expect(other.level).toBe("TRACE");
      expect(() => named.info("one")).not.toThrow();
    });

    it("does the same for an invalid part of LOG_LEVEL, read for the first time", ({
      expect,
    }) => {
      const warn = createLevelApp("test.module:verbose,warn");
      expect(warn.logger("test.module").level).toBe("WARN");
      expect(warn.logger("other.module").level).toBe("WARN");
      expect(() => warn.logger("test.module").warn("one")).not.toThrow();
      expect(warn.reports()).toHaveLength(1);

      const silent = createLevelApp("test.module:verbose,silent");
      expect(silent.logger("test.module").level).toBe("SILENT");

      const none = createLevelApp("test.module:verbose");
      expect(none.logger("test.module").level).toBe("INFO");
    });

    it("never throws for a module the invalid global level does not reach", ({
      expect,
    }) => {
      const { logger, reports, setLevel } = createLevelApp("info");
      const named = logger("test.module");
      const other = logger("other.module");
      expect(named.level).toBe("INFO");
      expect(other.level).toBe("INFO");

      // Valid for `test.module`, which never reads the global part.
      setLevel("test:debug,verbose");

      expect(named.level).toBe("DEBUG");
      expect(other.level).toBe("INFO");
      expect(logger("other.late").level).toBe("INFO");
      expect(() => other.info("one")).not.toThrow();
      expect(reports()).toEqual([
        'WARN Invalid global log level "verbose": the last valid level, "info", applies',
      ]);
    });

    it("gives two loggers of one module the same level, whichever met a value first", ({
      expect,
    }) => {
      const { logger, setLevel } = createLevelApp("info");
      const early = logger("test.module");
      const late = logger("test.module");
      expect(early.level).toBe("INFO");
      expect(late.level).toBe("INFO");

      // Only `late` meets the refused value the first time.
      setLevel("verbose");
      expect(late.level).toBe("INFO");

      // Only `early` meets the valid one in between.
      setLevel("debug");
      expect(early.level).toBe("DEBUG");

      setLevel("verbose");
      expect(early.level).toBe("DEBUG");
      expect(late.level).toBe("DEBUG");
      expect(logger("test.module").level).toBe("DEBUG");
    });

    it("falls back to the last valid value, not to one valid for a single module", ({
      expect,
    }) => {
      const { logger, reports, setLevel } = createLevelApp("info");
      const named = logger("test.module");
      expect(named.level).toBe("INFO");

      // Valid for `test.module` alone: its global part never parses.
      setLevel("test:debug,verbose");
      expect(named.level).toBe("DEBUG");

      setLevel("loud");
      expect(named.level).toBe("INFO");
      expect(logger("test.module").level).toBe("INFO");
      expect(reports().at(-1)).toBe(
        'WARN Invalid global log level "loud": the last valid level, "info", applies',
      );
    });

    it("matches a pattern made of many wildcards without backtracking", ({
      expect,
    }) => {
      const logger = createLevelApp("info").logger("test.module");
      const stars = "*".repeat(30);
      // Matching is synchronous, so a test timeout could never interrupt a
      // regression: the time is measured here. As a regular expression the
      // first pattern below ran for minutes.
      const startedAt = performance.now();

      expect(logger.parseLevel(`${stars}x:debug,warn`, "a".repeat(40))).toBe(
        "WARN",
      );
      expect(
        logger.parseLevel(`${"*a".repeat(30)}*x:debug,warn`, "a".repeat(60)),
      ).toBe("WARN");
      expect(
        logger.parseLevel(`${stars}module:debug,warn`, "test.module"),
      ).toBe("DEBUG");
      expect(logger.parseLevel("t*t.m*e:debug,warn", "test.module")).toBe(
        "DEBUG",
      );
      // A pattern is text, never a regular expression.
      expect(logger.parseLevel("test.(module):debug,warn", "test.module")).toBe(
        "WARN",
      );
      expect(logger.parseLevel("test.:debug,warn", "testXmodule")).toBe("WARN");
      expect(performance.now() - startedAt).toBeLessThan(1_000);
    });

    it("still refuses an invalid global level set by LOG_LEVEL on the first read", ({
      expect,
    }) => {
      const { logger } = createLevelApp("verbose");

      expect(() => logger("test.module").level).toThrow(
        'Invalid global log level "verbose"',
      );
    });
  });

  describe("format getter", () => {
    const make = () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "info" } })
        .with({
          provide: LogDestinationProvider,
          use: MemoryDestinationProvider,
        })
        .with({
          provide: LogFormatterProvider,
          use: PrettyFormatterProvider,
        });
      const logger = alepha.inject(TestLogger, {
        lifetime: "transient",
        args: ["TestService", "test.module"],
      });
      return { alepha, logger };
    };

    it("falls back to the register-time formatter when unset", ({ expect }) => {
      const { logger } = make();
      expect(logger.activeFormatter).toBeInstanceOf(PrettyFormatterProvider);
    });

    it("honors the alepha.logger.format state override (read live)", ({
      expect,
    }) => {
      const { alepha, logger } = make();

      alepha.store.set("alepha.logger.format", "json");
      expect(logger.activeFormatter).toBeInstanceOf(JsonFormatterProvider);

      alepha.store.set("alepha.logger.format", "raw");
      expect(logger.activeFormatter).toBeInstanceOf(RawFormatterProvider);

      alepha.store.set("alepha.logger.format", "pretty");
      expect(logger.activeFormatter).toBeInstanceOf(PrettyFormatterProvider);

      // Unknown / cleared → back to the register-time default.
      alepha.store.set("alepha.logger.format", undefined);
      expect(logger.activeFormatter).toBeInstanceOf(PrettyFormatterProvider);
    });
  });

  describe("isLevelEnabled", () => {
    const at = (level: string) => {
      const alepha = Alepha.create().with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });
      const logger = alepha.inject(Logger, {
        lifetime: "transient",
        args: ["TestService", "test.module"],
      });
      // Set after inject: the logger module's register defaults the level to
      // "trace" in test mode, so a pre-inject set would be overwritten.
      alepha.store.set("alepha.logger.level", level);
      return { alepha, logger };
    };

    it("enables a level only when it is at or above the active level", ({
      expect,
    }) => {
      const { logger } = at("info");
      expect(logger.isLevelEnabled("ERROR")).toBe(true);
      expect(logger.isLevelEnabled("WARN")).toBe(true);
      expect(logger.isLevelEnabled("INFO")).toBe(true);
      expect(logger.isLevelEnabled("DEBUG")).toBe(false);
      expect(logger.isLevelEnabled("TRACE")).toBe(false);
    });

    it("enables DEBUG once the active level is debug, but not TRACE", ({
      expect,
    }) => {
      const { logger } = at("debug");
      expect(logger.isLevelEnabled("DEBUG")).toBe(true);
      expect(logger.isLevelEnabled("INFO")).toBe(true);
      expect(logger.isLevelEnabled("TRACE")).toBe(false);
    });

    it("enables everything at trace and reacts to live state changes", ({
      expect,
    }) => {
      const { alepha, logger } = at("trace");
      expect(logger.isLevelEnabled("TRACE")).toBe(true);
      expect(logger.isLevelEnabled("DEBUG")).toBe(true);

      alepha.store.set("alepha.logger.level", "warn");
      expect(logger.isLevelEnabled("DEBUG")).toBe(false);
      expect(logger.isLevelEnabled("WARN")).toBe(true);
    });
  });
});
