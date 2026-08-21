import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $command } from "../primitives/$command.ts";
import { CliProvider } from "../providers/CliProvider.ts";

/**
 * Test subclass that exposes protected methods for unit testing.
 */
class TestCliProvider extends CliProvider {
  public testParseFlags = this.parseFlags.bind(this);
  public testParseCommandArgs = this.parseCommandArgs.bind(this);
  public testParseArgumentValue = this.parseArgumentValue.bind(this);
  public testParseModeFlag = this.parseModeFlag.bind(this);
  public testResolveCommand = this.resolveCommand.bind(this);
  public testResolveCommandFromArgv = this.resolveCommandFromArgv.bind(this);
  public testRemoveConsumedArgs = this.removeConsumedArgs.bind(this);
  public testGetFlagConsumedIndices = this.getFlagConsumedIndices.bind(this);
  public testGenerateArgsUsage = this.generateArgsUsage.bind(this);
  public testGenerateColoredArgsUsage =
    this.generateColoredArgsUsage.bind(this);
  public testGetTypeName = this.getTypeName.bind(this);
  public testGetTopLevelCommands = this.getTopLevelCommands.bind(this);
  public testFindParentCommand = this.findParentCommand.bind(this);
  public testGetCommandPath = this.getCommandPath.bind(this);
  public testFindCommand = this.findCommand.bind(this);
  public testFindPreHooks = this.findPreHooks.bind(this);
  public testFindPostHooks = this.findPostHooks.bind(this);
  public testGetEnumValues = this.getEnumValues.bind(this);
  public testFormatFlagDescription = this.formatFlagDescription.bind(this);
  public testParseCommandEnv = this.parseCommandEnv.bind(this);

  /**
   * Extract flag definitions from a command's flags schema (for testing printHelp logic).
   *
   * Delegates to the real `extractFlagDefs`, which reads aliases/description from
   * the schema's `.meta()` registry (zod) — under typebox these were direct
   * schema properties, but strict-zod stores them in metadata.
   */
  public testExtractFlagDefs = this.extractFlagDefs.bind(this);

  /**
   * Format aliases array into flag string (e.g., "-t, --target").
   * Sorts by length (shorter first).
   */
  public testFormatFlagStr(aliases: string[]): string {
    return aliases
      .slice()
      .sort((a, b) => a.length - b.length)
      .map((a) => (a.length === 1 ? `-${a}` : `--${a}`))
      .join(", ");
  }
}

describe("CliProvider", () => {
  describe("positional args vs flag values", () => {
    // `positionalArgs = argv.filter(a => !a.startsWith("-"))` ran BEFORE flag
    // parsing, so a space-separated flag value was treated as a command name.
    class App {
      // A child whose name collides with a plausible flag value.
      vercel = $command({
        name: "vercel",
        handler: () => {},
      });

      deploy = $command({
        name: "deploy",
        flags: z.object({ target: z.text().optional() }),
        children: [this.vercel],
        handler: () => {},
      });

      build = $command({ name: "build", handler: () => {} });
    }

    const create = () => {
      const alepha = Alepha.create().with(App);
      return alepha.inject(TestCliProvider);
    };

    it("should not treat a flag value as a subcommand", () => {
      const cli = create();

      const { command } = cli.testResolveCommandFromArgv([
        "deploy",
        "--target",
        "vercel",
      ]);

      expect(command?.name).toBe("deploy");
    });

    it("should resolve a command that follows a global flag value", () => {
      const cli = create();

      const { command } = cli.testResolveCommandFromArgv([
        "--target",
        "production",
        "build",
      ]);

      expect(command?.name).toBe("build");
    });

    it("should still resolve a real subcommand", () => {
      const cli = create();

      const { command } = cli.testResolveCommandFromArgv(["deploy", "vercel"]);

      expect(command?.name).toBe("vercel");
    });
  });

  const createTestCli = () => {
    const alepha = Alepha.create();
    return alepha.inject(TestCliProvider);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // parseFlags
  // ─────────────────────────────────────────────────────────────────────────────

  describe("parseFlags", () => {
    it("should parse boolean flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["--verbose"], flagDefs);
      expect(result.verbose).toBe(true);
    });

    it("should parse short boolean flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["-v"], flagDefs);
      expect(result.verbose).toBe(true);
    });

    it("should parse string flags with = syntax", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "name", aliases: ["n", "name"], schema: z.string() },
      ];

      const result = cli.testParseFlags(["--name=hello"], flagDefs);
      expect(result.name).toBe("hello");
    });

    it("should parse string flags with space syntax", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "name", aliases: ["n", "name"], schema: z.string() },
      ];

      const result = cli.testParseFlags(["--name", "hello"], flagDefs);
      expect(result.name).toBe("hello");
    });

    it("should parse JSON object flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "config", aliases: ["config"], schema: z.object({}) },
      ];

      const result = cli.testParseFlags(
        ["--config", '{"key":"value"}'],
        flagDefs,
      );
      expect(result.config).toEqual({ key: "value" });
    });

    it("should parse JSON array flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "items", aliases: ["items"], schema: z.array(z.string()) },
      ];

      const result = cli.testParseFlags(["--items", '["a","b"]'], flagDefs);
      expect(result.items).toEqual(["a", "b"]);
    });

    it("should throw on unknown flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "known", aliases: ["known"], schema: z.boolean() },
      ];

      expect(() =>
        cli.testParseFlags(["--unknown", "--known"], flagDefs),
      ).toThrow("Unknown flag: --unknown");
    });

    it("should throw on missing required value", () => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: z.string() }];

      expect(() => cli.testParseFlags(["--name"], flagDefs)).toThrow(
        "requires a value",
      );
    });

    it("should throw on invalid JSON", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "config", aliases: ["config"], schema: z.object({}) },
      ];

      expect(() =>
        cli.testParseFlags(["--config", "{invalid}"], flagDefs),
      ).toThrow("Invalid JSON");
    });

    it("should parse union(boolean, text) flag without value as true", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      const result = cli.testParseFlags(["-i"], flagDefs);
      expect(result.image).toBe(true);
    });

    it("should parse union(boolean, text) flag with = value as string", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      const result = cli.testParseFlags(["-i=1.3.4"], flagDefs);
      expect(result.image).toBe("1.3.4");
    });

    it("should parse union(boolean, text) flag with space value as string", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      const result = cli.testParseFlags(["-i", "1.3.4"], flagDefs);
      expect(result.image).toBe("1.3.4");
    });

    it("should parse union(boolean, text) flag without value when followed by another flag", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["-i", "-v"], flagDefs);
      expect(result.image).toBe(true);
      expect(result.verbose).toBe(true);
    });

    it("should parse union(boolean, text) flag with long form without value", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      const result = cli.testParseFlags(["--image"], flagDefs);
      expect(result.image).toBe(true);
    });

    it("should parse union(boolean, text) flag at end of argv without value", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["-v", "-i"], flagDefs);
      expect(result.verbose).toBe(true);
      expect(result.image).toBe(true);
    });

    it("should parse union(boolean, text) with empty = value as empty string", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      // Note: --image= results in empty string value
      const result = cli.testParseFlags(["--image="], flagDefs);
      // Empty string is falsy, so it goes through the "no value" path → true
      // This is expected behavior - use --image="" if you need empty string
      expect(result.image).toBe(true);
    });

    it("should parse union(boolean, text) with value containing special chars", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      const result = cli.testParseFlags(
        ["--image=my-org/my-app:v1.2.3-beta"],
        flagDefs,
      );
      expect(result.image).toBe("my-org/my-app:v1.2.3-beta");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // parseArgumentValue
  // ─────────────────────────────────────────────────────────────────────────────

  describe("parseArgumentValue", () => {
    it("should parse string values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("hello", z.string())).toBe("hello");
    });

    it("should parse number values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("42", z.number())).toBe(42);
      expect(cli.testParseArgumentValue("3.14", z.number())).toBe(3.14);
    });

    it("should throw on invalid number", () => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("abc", z.number())).toThrow(
        "Expected number",
      );
    });

    it("should parse integer values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("42", z.integer())).toBe(42);
    });

    it("should throw on non-integer for integer schema", () => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("3.14", z.integer())).toThrow(
        "Expected integer",
      );
    });

    it("should parse boolean true values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("true", z.boolean())).toBe(true);
      expect(cli.testParseArgumentValue("1", z.boolean())).toBe(true);
    });

    it("should parse boolean false values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("false", z.boolean())).toBe(false);
      expect(cli.testParseArgumentValue("0", z.boolean())).toBe(false);
    });

    it("should throw on invalid boolean", () => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("yes", z.boolean())).toThrow(
        "Expected boolean",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // parseCommandArgs
  // ─────────────────────────────────────────────────────────────────────────────

  describe("parseCommandArgs", () => {
    it("should return undefined when no schema", () => {
      const cli = createTestCli();
      expect(
        cli.testParseCommandArgs(["arg"], undefined, true),
      ).toBeUndefined();
    });

    it("should parse optional args when present", () => {
      const cli = createTestCli();
      const schema = z.string().optional();
      expect(cli.testParseCommandArgs(["hello"], schema, true)).toBe("hello");
    });

    it("should return undefined for optional args when missing", () => {
      const cli = createTestCli();
      const schema = z.string().optional();
      expect(cli.testParseCommandArgs([], schema, true)).toBeUndefined();
    });

    it("should parse required args", () => {
      const cli = createTestCli();
      const schema = z.string();
      expect(cli.testParseCommandArgs(["hello"], schema, true)).toBe("hello");
    });

    it("should throw on missing required args", () => {
      const cli = createTestCli();
      const schema = z.string();
      expect(() => cli.testParseCommandArgs([], schema, true)).toThrow(
        "Missing required argument",
      );
    });

    it("should parse tuple args", () => {
      const cli = createTestCli();
      const schema = z.tuple([z.string(), z.number()]);
      const result = cli.testParseCommandArgs(["hello", "42"], schema, true);
      expect(result).toEqual(["hello", 42]);
    });

    it("should handle optional tuple items", () => {
      const cli = createTestCli();
      const schema = z.tuple([z.string(), z.number().optional()]);
      const result = cli.testParseCommandArgs(["hello"], schema, true);
      expect(result).toEqual(["hello", undefined]);
    });

    it("should skip flags when parsing args", () => {
      const cli = createTestCli();
      const schema = z.string();
      const flags = z.object({ verbose: z.boolean().optional() });
      const result = cli.testParseCommandArgs(
        ["--verbose", "hello"],
        schema,
        true,
        flags,
      );
      expect(result).toBe("hello");
    });

    it("should skip flag values when parsing args", () => {
      const cli = createTestCli();
      const schema = z.string();
      const flags = z.object({ name: z.string().optional() });
      const result = cli.testParseCommandArgs(
        ["--name", "ignored", "actual"],
        schema,
        true,
        flags,
      );
      expect(result).toBe("actual");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // parseModeFlag
  // ─────────────────────────────────────────────────────────────────────────────

  describe("parseModeFlag", () => {
    it("should parse --mode=value", () => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["--mode=production"])).toBe("production");
    });

    it("should parse -m=value", () => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["-m=staging"])).toBe("staging");
    });

    it("should parse --mode value", () => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["--mode", "production"])).toBe(
        "production",
      );
    });

    it("should parse -m value", () => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["-m", "staging"])).toBe("staging");
    });

    it("should return undefined when no mode flag", () => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["--other", "value"])).toBeUndefined();
    });

    it("should throw when --mode has no value", () => {
      const cli = createTestCli();
      expect(() => cli.testParseModeFlag(["--mode"])).toThrow(
        "requires a value",
      );
    });

    it("should throw when --mode followed by another flag", () => {
      const cli = createTestCli();
      expect(() => cli.testParseModeFlag(["--mode", "--other"])).toThrow(
        "requires a value",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // resolveCommand
  // ─────────────────────────────────────────────────────────────────────────────

  describe("resolveCommand", () => {
    it("should return undefined for empty args", () => {
      const cli = createTestCli();
      const result = cli.testResolveCommand([]);
      expect(result.command).toBeUndefined();
      expect(result.consumedArgs).toEqual([]);
    });

    it("should find command by name", () => {
      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      const result = cli.testResolveCommand(["build"]);
      expect(result.command?.name).toBe("build");
      expect(result.consumedArgs).toEqual(["build"]);
    });

    it("should find command by colon notation", () => {
      class TestCommands {
        deployVercel = $command({
          name: "deploy:vercel",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      const result = cli.testResolveCommand(["deploy:vercel"]);
      expect(result.command?.name).toBe("deploy:vercel");
      expect(result.consumedArgs).toEqual(["deploy:vercel"]);
    });

    it("should return undefined for unknown command", () => {
      const cli = createTestCli();
      const result = cli.testResolveCommand(["unknown"]);
      expect(result.command).toBeUndefined();
      expect(result.consumedArgs).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // removeConsumedArgs
  // ─────────────────────────────────────────────────────────────────────────────

  describe("removeConsumedArgs", () => {
    it("should remove consumed command args", () => {
      const cli = createTestCli();
      const result = cli.testRemoveConsumedArgs(
        ["build", "--verbose", "extra"],
        ["build"],
      );
      expect(result).toEqual(["--verbose", "extra"]);
    });

    it("should preserve flags", () => {
      const cli = createTestCli();
      const result = cli.testRemoveConsumedArgs(
        ["--flag", "build", "arg"],
        ["build"],
      );
      expect(result).toEqual(["--flag", "arg"]);
    });

    it("should remove multiple consumed args", () => {
      const cli = createTestCli();
      const result = cli.testRemoveConsumedArgs(
        ["deploy", "vercel", "--prod"],
        ["deploy", "vercel"],
      );
      expect(result).toEqual(["--prod"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getFlagConsumedIndices
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getFlagConsumedIndices", () => {
    it("should mark flag indices as consumed", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testGetFlagConsumedIndices(["--verbose"], flagDefs);
      expect(result.has(0)).toBe(true);
    });

    it("should mark flag value indices as consumed", () => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: z.string() }];

      const result = cli.testGetFlagConsumedIndices(
        ["--name", "value", "arg"],
        flagDefs,
      );
      expect(result.has(0)).toBe(true); // --name
      expect(result.has(1)).toBe(true); // value
      expect(result.has(2)).toBe(false); // arg
    });

    it("should not consume next arg for --flag=value syntax", () => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: z.string() }];

      const result = cli.testGetFlagConsumedIndices(
        ["--name=value", "arg"],
        flagDefs,
      );
      expect(result.has(0)).toBe(true); // --name=value
      expect(result.has(1)).toBe(false); // arg
    });

    it("should consume value for union(boolean, text) when value is provided", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      const result = cli.testGetFlagConsumedIndices(
        ["-i", "1.3.4", "arg"],
        flagDefs,
      );
      expect(result.has(0)).toBe(true); // -i
      expect(result.has(1)).toBe(true); // 1.3.4 (consumed as value)
      expect(result.has(2)).toBe(false); // arg
    });

    it("should not consume next arg for union(boolean, text) when next is a flag", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testGetFlagConsumedIndices(["-i", "-v"], flagDefs);
      expect(result.has(0)).toBe(true); // -i
      expect(result.has(1)).toBe(true); // -v (not consumed by -i, but by itself)
    });

    it("should not consume next arg for union(boolean, text) at end of argv", () => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      const result = cli.testGetFlagConsumedIndices(["-i"], flagDefs);
      expect(result.has(0)).toBe(true); // -i
      expect(result.size).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // generateArgsUsage
  // ─────────────────────────────────────────────────────────────────────────────

  describe("generateArgsUsage", () => {
    it("should return empty string for no schema", () => {
      const cli = createTestCli();
      expect(cli.testGenerateArgsUsage(undefined)).toBe("");
    });

    it("should generate optional arg usage", () => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" }).optional();
      expect(cli.testGenerateArgsUsage(schema)).toBe(" [path]");
    });

    it("should generate required arg usage", () => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <path>");
    });

    it("should generate tuple arg usage", () => {
      const cli = createTestCli();
      const schema = z.tuple([z.string(), z.number().optional()]);
      const result = cli.testGenerateArgsUsage(schema);
      expect(result).toContain("<arg1>");
      expect(result).toContain("[arg2");
    });

    it("should include type for numbers", () => {
      const cli = createTestCli();
      const schema = z.number().meta({ title: "count" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <count: number>");
    });

    it("should include type for integers", () => {
      const cli = createTestCli();
      const schema = z.integer().meta({ title: "port" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <port: integer>");
    });

    it("should include type for booleans", () => {
      const cli = createTestCli();
      const schema = z.boolean().meta({ title: "force" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <force: boolean>");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTypeName
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getTypeName", () => {
    it("should return empty for string", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.string())).toBe("");
    });

    it("should return ': number' for number", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.number())).toBe(": number");
    });

    it("should return ': integer' for integer", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.integer())).toBe(": integer");
    });

    it("should return ': boolean' for boolean", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.boolean())).toBe(": boolean");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // generateColoredArgsUsage
  // ─────────────────────────────────────────────────────────────────────────────

  describe("generateColoredArgsUsage", () => {
    it("should return empty string for no schema", () => {
      const cli = createTestCli();
      expect(cli.testGenerateColoredArgsUsage(undefined)).toBe("");
    });

    it("should generate colored optional arg usage", () => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" }).optional();
      const result = cli.testGenerateColoredArgsUsage(schema);
      expect(result).toContain("[path]");
    });

    it("should generate colored required arg usage", () => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" });
      const result = cli.testGenerateColoredArgsUsage(schema);
      expect(result).toContain("<path>");
    });

    it("should generate colored tuple arg usage", () => {
      const cli = createTestCli();
      const schema = z.tuple([z.string(), z.number().optional()]);
      const result = cli.testGenerateColoredArgsUsage(schema);
      expect(result).toContain("<arg1>");
      expect(result).toContain("[arg2");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findCommand
  // ─────────────────────────────────────────────────────────────────────────────

  describe("findCommand", () => {
    it("should return undefined for unknown command", () => {
      const cli = createTestCli();
      expect(cli.testFindCommand("unknown")).toBeUndefined();
    });

    it("should find command by name", () => {
      class TestCommands {
        test = $command({
          name: "test",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      expect(cli.testFindCommand("test")?.name).toBe("test");
    });

    it("should find command by alias", () => {
      class TestCommands {
        test = $command({
          name: "test",
          aliases: ["t"],
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      expect(cli.testFindCommand("t")?.name).toBe("test");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findPreHooks / findPostHooks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("findPreHooks", () => {
    it("should return empty array when no hooks", () => {
      const cli = createTestCli();
      expect(cli.testFindPreHooks("build")).toEqual([]);
    });

    it("should find pre-hooks for command", () => {
      class TestCommands {
        preBuild = $command({
          name: "prebuild",
          flags: z.object({}),
          handler: async () => {},
        });
        build = $command({
          name: "build",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      expect(cli.testFindPreHooks("build").length).toBe(1);
    });
  });

  describe("findPostHooks", () => {
    it("should return empty array when no hooks", () => {
      const cli = createTestCli();
      expect(cli.testFindPostHooks("build")).toEqual([]);
    });

    it("should find post-hooks for command", () => {
      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({}),
          handler: async () => {},
        });
        postBuild = $command({
          name: "postbuild",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      expect(cli.testFindPostHooks("build").length).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTopLevelCommands
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getTopLevelCommands", () => {
    it("should return all commands when no children", () => {
      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({}),
          handler: async () => {},
        });
        test = $command({
          name: "test",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      const topLevel = cli.testGetTopLevelCommands();
      expect(topLevel.length).toBe(2);
    });

    it("should exclude child commands", () => {
      class TestCommands {
        deployVercel = $command({
          name: "vercel",
          flags: z.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          flags: z.object({}),
          children: [this.deployVercel],
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      const topLevel = cli.testGetTopLevelCommands();
      expect(topLevel.length).toBe(1);
      expect(topLevel[0].name).toBe("deploy");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findParentCommand
  // ─────────────────────────────────────────────────────────────────────────────

  describe("findParentCommand", () => {
    it("should return undefined for top-level command", () => {
      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const cmd = cli.testFindCommand("build")!;

      expect(cli.testFindParentCommand(cmd)).toBeUndefined();
    });

    it("should find parent of child command", () => {
      class TestCommands {
        deployVercel = $command({
          name: "vercel",
          flags: z.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          flags: z.object({}),
          children: [this.deployVercel],
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const child = cli.testFindCommand("vercel")!;

      expect(cli.testFindParentCommand(child)?.name).toBe("deploy");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getCommandPath
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getCommandPath", () => {
    it("should return simple name for top-level command", () => {
      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const cmd = cli.testFindCommand("build")!;

      expect(cli.testGetCommandPath(cmd)).toBe("build");
    });

    it("should return full path for nested command", () => {
      class TestCommands {
        deployVercel = $command({
          name: "vercel",
          flags: z.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          flags: z.object({}),
          children: [this.deployVercel],
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const child = cli.testFindCommand("vercel")!;

      expect(cli.testGetCommandPath(child)).toBe("deploy vercel");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // printHelp
  // ─────────────────────────────────────────────────────────────────────────────

  describe("printHelp", () => {
    it("should print general help when no command provided", () => {
      class TestCommands {
        build = $command({
          name: "build",
          description: "Build the project",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      // Just verify it doesn't throw
      expect(() => cli.printHelp()).not.toThrow();
    });

    it("should print command-specific help", () => {
      class TestCommands {
        build = $command({
          name: "build",
          description: "Build the project",
          flags: z.object({
            watch: z.boolean().describe("Watch for changes").optional(),
          }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const cmd = cli.testFindCommand("build")!;

      expect(() => cli.printHelp(cmd)).not.toThrow();
    });

    it("should print help for command with children", () => {
      class TestCommands {
        deployVercel = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          flags: z.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          description: "Deploy commands",
          flags: z.object({}),
          children: [this.deployVercel],
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const cmd = cli.testFindCommand("deploy")!;

      expect(() => cli.printHelp(cmd)).not.toThrow();
    });

    it("should print help for command with env vars", () => {
      class TestCommands {
        deploy = $command({
          name: "deploy",
          description: "Deploy to production",
          flags: z.object({}),
          env: z.object({
            API_KEY: z.string().describe("API key for deployment"),
            REGION: z.string().describe("Target region").optional(),
          }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const cmd = cli.testFindCommand("deploy")!;

      expect(() => cli.printHelp(cmd)).not.toThrow();
    });

    it("should print help for command with mode option", () => {
      class TestCommands {
        build = $command({
          name: "build",
          description: "Build for environment",
          flags: z.object({}),
          mode: "development",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const cmd = cli.testFindCommand("build")!;

      expect(() => cli.printHelp(cmd)).not.toThrow();
    });

    it("should print help for command with args", () => {
      class TestCommands {
        greet = $command({
          name: "greet",
          description: "Greet someone",
          flags: z.object({}),
          args: z.string().meta({ title: "name" }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const cmd = cli.testFindCommand("greet")!;

      expect(() => cli.printHelp(cmd)).not.toThrow();
    });

    it("should hide commands with hide option in general help", () => {
      class TestCommands {
        visible = $command({
          name: "visible",
          description: "Visible command",
          flags: z.object({}),
          handler: async () => {},
        });
        hidden = $command({
          name: "hidden",
          description: "Hidden command",
          hide: true,
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      // Just verify it doesn't throw - hidden commands filtered in getTopLevelCommands
      expect(() => cli.printHelp()).not.toThrow();
    });

    it("should include flag aliases in help output", () => {
      const cli = createTestCli();

      const flagsSchema = z.object({
        target: z
          .enum(["bare", "docker", "vercel"])
          .meta({ aliases: ["t"] })
          .describe("Deployment target")
          .optional(),
        runtime: z
          .enum(["node", "bun"])
          .meta({ alias: "r" })
          .describe("JavaScript runtime")
          .optional(),
        verbose: z.boolean().describe("Verbose output").optional(),
      });

      const flagDefs = cli.testExtractFlagDefs(flagsSchema);

      // target should have key + aliases array
      const targetFlag = flagDefs.find((f) => f.key === "target");
      expect(targetFlag?.aliases).toContain("target");
      expect(targetFlag?.aliases).toContain("t");
      expect(cli.testFormatFlagStr(targetFlag!.aliases)).toBe("-t, --target");

      // runtime should have key + alias (singular)
      const runtimeFlag = flagDefs.find((f) => f.key === "runtime");
      expect(runtimeFlag?.aliases).toContain("runtime");
      expect(runtimeFlag?.aliases).toContain("r");
      expect(cli.testFormatFlagStr(runtimeFlag!.aliases)).toBe("-r, --runtime");

      // verbose should only have key (no aliases defined)
      const verboseFlag = flagDefs.find((f) => f.key === "verbose");
      expect(verboseFlag?.aliases).toEqual(["verbose"]);
      expect(cli.testFormatFlagStr(verboseFlag!.aliases)).toBe("--verbose");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getEnumValues
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getEnumValues", () => {
    it("should extract values from z.enum schema", () => {
      const cli = createTestCli();
      const schema = z.enum(["yarn", "npm", "pnpm", "bun"]);

      const values = cli.testGetEnumValues(schema);

      expect(values).toEqual(["yarn", "npm", "pnpm", "bun"]);
    });

    it("should return undefined for non-enum schemas", () => {
      const cli = createTestCli();

      expect(cli.testGetEnumValues(z.string())).toBeUndefined();
      expect(cli.testGetEnumValues(z.boolean())).toBeUndefined();
      expect(cli.testGetEnumValues(z.number())).toBeUndefined();
      expect(cli.testGetEnumValues(z.object({}))).toBeUndefined();
    });

    it("should return undefined for empty or undefined schema", () => {
      const cli = createTestCli();

      expect(cli.testGetEnumValues(undefined as any)).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // formatFlagDescription
  // ─────────────────────────────────────────────────────────────────────────────

  describe("formatFlagDescription", () => {
    it("should append enum values to description", () => {
      const cli = createTestCli();
      const schema = z.enum(["yarn", "npm", "pnpm", "bun"]);

      const result = cli.testFormatFlagDescription(
        "Package manager to use",
        schema,
      );

      expect(result).toContain("Package manager to use");
      expect(result).toContain("yarn");
      expect(result).toContain("npm");
      expect(result).toContain("pnpm");
      expect(result).toContain("bun");
    });

    it("should return only enum values when description is empty", () => {
      const cli = createTestCli();
      const schema = z.enum(["a", "b", "c"]);

      const result = cli.testFormatFlagDescription(undefined, schema);

      expect(result).toContain("a");
      expect(result).toContain("b");
      expect(result).toContain("c");
    });

    it("should return original description for non-enum schemas", () => {
      const cli = createTestCli();

      expect(cli.testFormatFlagDescription("A string flag", z.string())).toBe(
        "A string flag",
      );
      expect(cli.testFormatFlagDescription("A boolean flag", z.boolean())).toBe(
        "A boolean flag",
      );
    });

    it("should return empty string when no description and no enum", () => {
      const cli = createTestCli();

      expect(cli.testFormatFlagDescription(undefined, z.string())).toBe("");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // commands getter
  // ─────────────────────────────────────────────────────────────────────────────

  describe("commands", () => {
    it("should return all registered commands", () => {
      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({}),
          handler: async () => {},
        });
        test = $command({
          name: "test",
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      expect(cli.commands.length).toBe(2);
      expect(cli.commands.map((c) => c.name).sort()).toEqual(["build", "test"]);
    });

    it("should return empty array when no commands", () => {
      const cli = createTestCli();
      expect(cli.commands).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // parseCommandEnv
  // ─────────────────────────────────────────────────────────────────────────────

  describe("parseCommandEnv", () => {
    it("should use default value for required field with default when env var is missing", () => {
      const cli = createTestCli();
      const schema = z.object({
        MY_VAR: z.text({ default: "fallback" }),
      });

      delete process.env.MY_VAR;
      const result = cli.testParseCommandEnv(schema, "test");
      expect(result.MY_VAR).toBe("fallback");
    });

    it("should prefer env var over default when both exist", () => {
      const cli = createTestCli();
      const schema = z.object({
        MY_VAR: z.text({ default: "fallback" }),
      });

      process.env.MY_VAR = "from-env";
      try {
        const result = cli.testParseCommandEnv(schema, "test");
        expect(result.MY_VAR).toBe("from-env");
      } finally {
        delete process.env.MY_VAR;
      }
    });

    it("should throw for required field without default when env var is missing", () => {
      const cli = createTestCli();
      const schema = z.object({
        MY_VAR: z.text(),
      });

      delete process.env.MY_VAR;
      expect(() => cli.testParseCommandEnv(schema, "test")).toThrow(
        "Missing required environment variable",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // run (test helper)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("run", () => {
    it("should execute command with string args", async () => {
      let capturedFlags: Record<string, unknown> = {};

      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({
            watch: z.boolean().optional(),
          }),
          handler: async ({ flags }) => {
            capturedFlags = flags;
          },
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestCommands);

      await cli.run(cmd.build, "--watch");

      expect(capturedFlags.watch).toBe(true);
    });

    it("should execute command with array args", async () => {
      let capturedFlags: Record<string, unknown> = {};

      class TestCommands {
        greet = $command({
          name: "greet",
          flags: z.object({
            name: z.string().optional(),
          }),
          handler: async ({ flags }) => {
            capturedFlags = flags;
          },
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestCommands);

      await cli.run(cmd.greet, ["--name", "World"]);

      expect(capturedFlags.name).toBe("World");
    });

    it("should execute command with options object", async () => {
      let capturedRoot = "";

      class TestCommands {
        init = $command({
          name: "init",
          flags: z.object({}),
          handler: async ({ root }) => {
            capturedRoot = root;
          },
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestCommands);

      await cli.run(cmd.init, { root: "/custom/path" });

      expect(capturedRoot).toBe("/custom/path");
    });

    it("should parse command args", async () => {
      let capturedArgs: unknown;

      class TestCommands {
        greet = $command({
          name: "greet",
          flags: z.object({}),
          args: z.string(),
          handler: async ({ args }) => {
            capturedArgs = args;
          },
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestCommands);

      await cli.run(cmd.greet, "World");

      expect(capturedArgs).toBe("World");
    });
  });
});
