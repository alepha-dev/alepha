import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $command } from "../primitives/$command.ts";
import { CliProvider } from "../providers/CliProvider.ts";
import { ConsoleOutputProvider } from "../providers/ConsoleOutputProvider.ts";
import { MemoryOutputProvider } from "../providers/MemoryOutputProvider.ts";

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

    it("should not treat a flag value as a subcommand", ({ expect }) => {
      const cli = create();

      const { command } = cli.testResolveCommandFromArgv([
        "deploy",
        "--target",
        "vercel",
      ]);

      expect(command?.name).toBe("deploy");
    });

    it("should resolve a command that follows another command's flag value", ({
      expect,
    }) => {
      const cli = create();

      const { command } = cli.testResolveCommandFromArgv([
        "--target",
        "production",
        "build",
      ]);

      expect(command?.name).toBe("build");
    });

    it("should still resolve a real subcommand", ({ expect }) => {
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
    it("should parse boolean flags", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["--verbose"], flagDefs);
      expect(result.verbose).toBe(true);
    });

    it("should parse short boolean flags", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["-v"], flagDefs);
      expect(result.verbose).toBe(true);
    });

    it("should parse string flags with = syntax", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "name", aliases: ["n", "name"], schema: z.string() },
      ];

      const result = cli.testParseFlags(["--name=hello"], flagDefs);
      expect(result.name).toBe("hello");
    });

    it("should parse string flags with space syntax", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "name", aliases: ["n", "name"], schema: z.string() },
      ];

      const result = cli.testParseFlags(["--name", "hello"], flagDefs);
      expect(result.name).toBe("hello");
    });

    it("should parse JSON object flags", ({ expect }) => {
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

    it("should parse JSON array flags", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "items", aliases: ["items"], schema: z.array(z.string()) },
      ];

      const result = cli.testParseFlags(["--items", '["a","b"]'], flagDefs);
      expect(result.items).toEqual(["a", "b"]);
    });

    it("should throw on unknown flags", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "known", aliases: ["known"], schema: z.boolean() },
      ];

      expect(() =>
        cli.testParseFlags(["--unknown", "--known"], flagDefs),
      ).toThrow("Unknown flag: --unknown");
    });

    it("should throw on missing required value", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: z.string() }];

      expect(() => cli.testParseFlags(["--name"], flagDefs)).toThrow(
        "requires a value",
      );
    });

    it("should throw on invalid JSON", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "config", aliases: ["config"], schema: z.object({}) },
      ];

      expect(() =>
        cli.testParseFlags(["--config", "{invalid}"], flagDefs),
      ).toThrow("Invalid JSON");
    });

    it("should parse union(boolean, text) flag without value as true", ({
      expect,
    }) => {
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

    it("should parse union(boolean, text) flag with = value as string", ({
      expect,
    }) => {
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

    it("should parse union(boolean, text) flag with space value as string", ({
      expect,
    }) => {
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

    it("should parse union(boolean, text) flag without value when followed by another flag", ({
      expect,
    }) => {
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

    it("should parse union(boolean, text) flag with long form without value", ({
      expect,
    }) => {
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

    it("should parse union(boolean, text) flag at end of argv without value", ({
      expect,
    }) => {
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

    it("should parse union(boolean, text) with an empty = value as true, and leave the next token a positional", ({
      expect,
    }) => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "image",
          aliases: ["i", "image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      expect(cli.testParseFlags(["--image="], flagDefs).image).toBe(true);

      // The `=` says the value is not the next token: taking it here, while
      // `getFlagConsumedIndices` leaves it a positional, would bind one word
      // twice.
      const argv = ["--image=", "target"];
      expect(cli.testParseFlags(argv, flagDefs).image).toBe(true);
      expect(cli.testGetFlagConsumedIndices(argv, flagDefs).has(1)).toBe(false);
    });

    it("should parse union(boolean, text) with value containing special chars", ({
      expect,
    }) => {
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
    it("should parse string values", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("hello", z.string())).toBe("hello");
    });

    it("should parse number values", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("42", z.number())).toBe(42);
      expect(cli.testParseArgumentValue("3.14", z.number())).toBe(3.14);
    });

    it("should throw on invalid number", ({ expect }) => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("abc", z.number())).toThrow(
        "Expected number",
      );
    });

    it("should parse integer values", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("42", z.integer())).toBe(42);
    });

    it("should throw on non-integer for integer schema", ({ expect }) => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("3.14", z.integer())).toThrow(
        "Expected integer",
      );
    });

    it("should parse boolean true values", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("true", z.boolean())).toBe(true);
      expect(cli.testParseArgumentValue("1", z.boolean())).toBe(true);
    });

    it("should parse boolean false values", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("false", z.boolean())).toBe(false);
      expect(cli.testParseArgumentValue("0", z.boolean())).toBe(false);
    });

    it("should throw on invalid boolean", ({ expect }) => {
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
    it("should return undefined when no schema", ({ expect }) => {
      const cli = createTestCli();
      expect(
        cli.testParseCommandArgs(["arg"], undefined, true),
      ).toBeUndefined();
    });

    it("should parse optional args when present", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.string().optional();
      expect(cli.testParseCommandArgs(["hello"], schema, true)).toBe("hello");
    });

    it("should return undefined for optional args when missing", ({
      expect,
    }) => {
      const cli = createTestCli();
      const schema = z.string().optional();
      expect(cli.testParseCommandArgs([], schema, true)).toBeUndefined();
    });

    it("should parse required args", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.string();
      expect(cli.testParseCommandArgs(["hello"], schema, true)).toBe("hello");
    });

    it("should throw on missing required args", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.string();
      expect(() => cli.testParseCommandArgs([], schema, true)).toThrow(
        "Missing required argument",
      );
    });

    it("should parse tuple args", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.tuple([z.string(), z.number()]);
      const result = cli.testParseCommandArgs(["hello", "42"], schema, true);
      expect(result).toEqual(["hello", 42]);
    });

    it("should handle optional tuple items", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.tuple([z.string(), z.number().optional()]);
      const result = cli.testParseCommandArgs(["hello"], schema, true);
      expect(result).toEqual(["hello", undefined]);
    });

    it("should skip flags when parsing args", ({ expect }) => {
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

    it("should skip flag values when parsing args", ({ expect }) => {
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
    it("should parse --mode=value", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["--mode=production"])).toBe("production");
    });

    it("should parse -m=value", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["-m=staging"])).toBe("staging");
    });

    it("should parse --mode value", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["--mode", "production"])).toBe(
        "production",
      );
    });

    it("should parse -m value", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["-m", "staging"])).toBe("staging");
    });

    it("should return undefined when no mode flag", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["--other", "value"])).toBeUndefined();
    });

    it("should throw when --mode has no value", ({ expect }) => {
      const cli = createTestCli();
      expect(() => cli.testParseModeFlag(["--mode"])).toThrow(
        "requires a value",
      );
    });

    it("should read the mode in every spelling the flag parser accepts as --mode", ({
      expect,
    }) => {
      const cli = createTestCli();
      // `parseFlags` strips one or two dashes, so it takes these for the mode
      // flag: reading none here ran the command in no mode, exit 0.
      expect(cli.testParseModeFlag(["--m", "production"])).toBe("production");
      expect(cli.testParseModeFlag(["-mode", "production"])).toBe("production");
      expect(cli.testParseModeFlag(["-mode=staging"])).toBe("staging");
      expect(cli.testParseModeFlag(["--model", "x"])).toBeUndefined();
    });

    it("should keep an = inside the mode value", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testParseModeFlag(["--mode=a=b"])).toBe("a=b");
    });

    it("should throw when --mode followed by another flag", ({ expect }) => {
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
    it("should return undefined for empty args", ({ expect }) => {
      const cli = createTestCli();
      const result = cli.testResolveCommand([]);
      expect(result.command).toBeUndefined();
      expect(result.consumedArgs).toEqual([]);
    });

    it("should find command by name", ({ expect }) => {
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

    it("should find command by colon notation", ({ expect }) => {
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

    it("should return undefined for unknown command", ({ expect }) => {
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
    it("should remove consumed command args", ({ expect }) => {
      const cli = createTestCli();
      const result = cli.testRemoveConsumedArgs(
        ["build", "--verbose", "extra"],
        ["build"],
      );
      expect(result).toEqual(["--verbose", "extra"]);
    });

    it("should preserve flags", ({ expect }) => {
      const cli = createTestCli();
      const result = cli.testRemoveConsumedArgs(
        ["--flag", "build", "arg"],
        ["build"],
      );
      expect(result).toEqual(["--flag", "arg"]);
    });

    it("should remove multiple consumed args", ({ expect }) => {
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
    it("should mark flag indices as consumed", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
      ];

      const result = cli.testGetFlagConsumedIndices(["--verbose"], flagDefs);
      expect(result.has(0)).toBe(true);
    });

    it("should mark flag value indices as consumed", ({ expect }) => {
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

    it("should not consume next arg for --flag=value syntax", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: z.string() }];

      const result = cli.testGetFlagConsumedIndices(
        ["--name=value", "arg"],
        flagDefs,
      );
      expect(result.has(0)).toBe(true); // --name=value
      expect(result.has(1)).toBe(false); // arg
    });

    it("should consume value for union(boolean, text) when value is provided", ({
      expect,
    }) => {
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

    it("should not consume next arg for union(boolean, text) at end of argv", ({
      expect,
    }) => {
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
    it("should return empty string for no schema", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testGenerateArgsUsage(undefined)).toBe("");
    });

    it("should generate optional arg usage", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" }).optional();
      expect(cli.testGenerateArgsUsage(schema)).toBe(" [path]");
    });

    it("should generate required arg usage", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <path>");
    });

    it("should generate tuple arg usage", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.tuple([z.string(), z.number().optional()]);
      const result = cli.testGenerateArgsUsage(schema);
      expect(result).toContain("<arg1>");
      expect(result).toContain("[arg2");
    });

    it("names each tuple item by its title when it has one", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.tuple([
        z.text({ title: "repository" }),
        z.text({ title: "dir" }).optional(),
      ]);
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <repository> [dir]");
    });

    it("should include type for numbers", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.number().meta({ title: "count" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <count: number>");
    });

    it("should include type for integers", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.integer().meta({ title: "port" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <port: integer>");
    });

    it("should include type for booleans", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.boolean().meta({ title: "force" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <force: boolean>");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTypeName
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getTypeName", () => {
    it("should return empty for string", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.string())).toBe("");
    });

    it("should return ': number' for number", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.number())).toBe(": number");
    });

    it("should return ': integer' for integer", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.integer())).toBe(": integer");
    });

    it("should return ': boolean' for boolean", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(z.boolean())).toBe(": boolean");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // generateColoredArgsUsage
  // ─────────────────────────────────────────────────────────────────────────────

  describe("generateColoredArgsUsage", () => {
    it("should return empty string for no schema", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testGenerateColoredArgsUsage(undefined)).toBe("");
    });

    it("should generate colored optional arg usage", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" }).optional();
      const result = cli.testGenerateColoredArgsUsage(schema);
      expect(result).toContain("[path]");
    });

    it("should generate colored required arg usage", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.string().meta({ title: "path" });
      const result = cli.testGenerateColoredArgsUsage(schema);
      expect(result).toContain("<path>");
    });

    it("should generate colored tuple arg usage", ({ expect }) => {
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
    it("should return undefined for unknown command", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testFindCommand("unknown")).toBeUndefined();
    });

    it("should find command by name", ({ expect }) => {
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

    it("should find command by alias", ({ expect }) => {
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
    it("should return empty array when no hooks", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testFindPreHooks("build")).toEqual([]);
    });

    it("should find pre-hooks for command", ({ expect }) => {
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
    it("should return empty array when no hooks", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.testFindPostHooks("build")).toEqual([]);
    });

    it("should find post-hooks for command", ({ expect }) => {
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
    it("should return all commands when no children", ({ expect }) => {
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

    it("should exclude child commands", ({ expect }) => {
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
    it("should return undefined for top-level command", ({ expect }) => {
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

    it("should find parent of child command", ({ expect }) => {
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
    it("should return simple name for top-level command", ({ expect }) => {
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

    it("should return full path for nested command", ({ expect }) => {
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

  // General and command help, env vars, `--mode` and arguments are asserted
  // on real output in $command.spec.ts ("Help Message" and after).
  describe("printHelp", () => {
    const capture = (commands: new () => object) => {
      const alepha = Alepha.create({ env: { NO_COLOR: "true" } })
        .with(commands)
        .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });

      return {
        cli: alepha.inject(TestCliProvider),
        output: alepha.inject(MemoryOutputProvider),
      };
    };

    it("should list a group's children, and leave out a hidden one", ({
      expect,
    }) => {
      class TestCommands {
        deployVercel = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          handler: async () => {},
        });
        deploySecret = $command({
          name: "secret",
          description: "Not for the help",
          hide: true,
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          description: "Deploy commands",
          children: [this.deployVercel, this.deploySecret],
          handler: async () => {},
        });
      }

      const { cli, output } = capture(TestCommands);
      cli.printHelp(cli.testFindCommand("deploy"));

      expect(output.text).toContain("Usage: cli deploy <command>");
      expect(output.text).toMatch(/cli deploy vercel\s+Deploy to Vercel/);
      expect(output.text).not.toContain("secret");
    });

    it("should hide commands with hide option in general help", ({
      expect,
    }) => {
      class TestCommands {
        visible = $command({
          name: "visible",
          description: "Visible command",
          handler: async () => {},
        });
        hidden = $command({
          name: "hidden",
          description: "Hidden command",
          hide: true,
          handler: async () => {},
        });
      }

      const { cli, output } = capture(TestCommands);
      cli.printHelp();

      expect(output.text).toContain("Visible command");
      expect(output.text).not.toContain("hidden");
      expect(output.text).not.toContain("Hidden command");
    });

    it("should include flag aliases in help output, shortest first", ({
      expect,
    }) => {
      class TestCommands {
        deploy = $command({
          name: "deploy",
          flags: z.object({
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
          }),
          handler: async () => {},
        });
      }

      const { cli, output } = capture(TestCommands);
      cli.printHelp(cli.testFindCommand("deploy"));

      expect(output.text).toMatch(/^ {4}-t, --target\s+Deployment target/m);
      expect(output.text).toMatch(/^ {4}-r, --runtime\s+JavaScript runtime/m);
      expect(output.text).toMatch(/^ {4}--verbose\s+Verbose output/m);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getEnumValues
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getEnumValues", () => {
    it("should extract values from z.enum schema", ({ expect }) => {
      const cli = createTestCli();
      const schema = z.enum(["yarn", "npm", "pnpm", "bun"]);

      const values = cli.testGetEnumValues(schema);

      expect(values).toEqual(["yarn", "npm", "pnpm", "bun"]);
    });

    it("should return undefined for non-enum schemas", ({ expect }) => {
      const cli = createTestCli();

      expect(cli.testGetEnumValues(z.string())).toBeUndefined();
      expect(cli.testGetEnumValues(z.boolean())).toBeUndefined();
      expect(cli.testGetEnumValues(z.number())).toBeUndefined();
      expect(cli.testGetEnumValues(z.object({}))).toBeUndefined();
    });

    it("should return undefined for empty or undefined schema", ({
      expect,
    }) => {
      const cli = createTestCli();

      expect(cli.testGetEnumValues(undefined as any)).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // formatFlagDescription
  // ─────────────────────────────────────────────────────────────────────────────

  describe("formatFlagDescription", () => {
    it("should append enum values to description", ({ expect }) => {
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

    it("should return only enum values when description is empty", ({
      expect,
    }) => {
      const cli = createTestCli();
      const schema = z.enum(["a", "b", "c"]);

      const result = cli.testFormatFlagDescription(undefined, schema);

      expect(result).toContain("a");
      expect(result).toContain("b");
      expect(result).toContain("c");
    });

    it("should return original description for non-enum schemas", ({
      expect,
    }) => {
      const cli = createTestCli();

      expect(cli.testFormatFlagDescription("A string flag", z.string())).toBe(
        "A string flag",
      );
      expect(cli.testFormatFlagDescription("A boolean flag", z.boolean())).toBe(
        "A boolean flag",
      );
    });

    it("should return empty string when no description and no enum", ({
      expect,
    }) => {
      const cli = createTestCli();

      expect(cli.testFormatFlagDescription(undefined, z.string())).toBe("");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // commands getter
  // ─────────────────────────────────────────────────────────────────────────────

  describe("commands", () => {
    it("should return all registered commands", ({ expect }) => {
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

    it("should return empty array when no commands", ({ expect }) => {
      const cli = createTestCli();
      expect(cli.commands).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // parseCommandEnv
  // ─────────────────────────────────────────────────────────────────────────────

  describe("parseCommandEnv", () => {
    it("should use default value for required field with default when env var is missing", ({
      expect,
    }) => {
      const cli = createTestCli();
      const schema = z.object({
        MY_VAR: z.text({ default: "fallback" }),
      });

      delete process.env.MY_VAR;
      const result = cli.testParseCommandEnv(schema, "test");
      expect(result.MY_VAR).toBe("fallback");
    });

    it("should prefer env var over default when both exist", ({ expect }) => {
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

    it("should throw for required field without default when env var is missing", ({
      expect,
    }) => {
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
    it("should execute command with string args", async ({ expect }) => {
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

    it("should execute command with array args", async ({ expect }) => {
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

    it("should execute command with options object", async ({ expect }) => {
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

    it("should parse command args", async ({ expect }) => {
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

  // ────────────────────────────────────────────────────────────────────────────
  // `--` terminator
  // ────────────────────────────────────────────────────────────────────────────

  describe("-- terminator", () => {
    const flagDefs = [
      { key: "name", aliases: ["n", "name"], schema: z.text() },
      { key: "verbose", aliases: ["v", "verbose"], schema: z.boolean() },
    ];

    it("should stop parsing flags at --", ({ expect }) => {
      const cli = createTestCli();

      const result = cli.testParseFlags(
        ["--name", "hello", "--", "--verbose"],
        flagDefs,
      );

      expect(result.name).toBe("hello");
      expect(result.verbose).toBeUndefined();
    });

    it("should not reject an unknown flag after --", ({ expect }) => {
      const cli = createTestCli();

      expect(() =>
        cli.testParseFlags(["--", "--not-a-flag"], flagDefs),
      ).not.toThrow();
    });

    it("should keep -- so the terminator survives command path removal", ({
      expect,
    }) => {
      const cli = createTestCli();

      const result = cli.testRemoveConsumedArgs(
        ["deploy", "--", "--raw"],
        ["deploy"],
      );

      expect(result).toEqual(["--", "--raw"]);
    });

    it("should pass a dash-leading positional through", async ({ expect }) => {
      let captured: unknown;

      class TestCommands {
        echo = $command({
          name: "echo",
          flags: z.object({ verbose: z.boolean().optional() }),
          args: z.string(),
          handler: async ({ args }) => {
            captured = args;
          },
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestCommands);

      await cli.run(cmd.echo, "--verbose -- --looks-like-a-flag");

      expect(captured).toBe("--looks-like-a-flag");
    });

    it("should carry a dash-leading positional through a subcommand path", ({
      expect,
    }) => {
      class TestCommands {
        vercel = $command({
          name: "vercel",
          args: z.string(),
          handler: () => {},
        });

        deploy = $command({
          name: "deploy",
          children: [this.vercel],
          handler: () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);
      const argv = ["deploy", "vercel", "--", "--raw"];

      const { command, consumedArgs } = cli.testResolveCommandFromArgv(argv);
      expect(command?.name).toBe("vercel");

      const remaining = cli.testRemoveConsumedArgs(argv, consumedArgs);
      expect(remaining).toEqual(["--", "--raw"]);

      const args = cli.testParseCommandArgs(
        remaining,
        command?.options.args,
        true,
        command?.flags,
      );
      expect(args).toBe("--raw");
    });

    it("should not read a value across the terminator", ({ expect }) => {
      const cli = createTestCli();

      expect(() => cli.testParseFlags(["--name", "--"], flagDefs)).toThrow(
        /requires a value/,
      );
    });

    it("should ignore --mode after the terminator", ({ expect }) => {
      const cli = createTestCli();

      expect(
        cli.testParseModeFlag(["--", "--mode", "production"]),
      ).toBeUndefined();
    });
  });

  describe("help footer", () => {
    class TestCommands {
      build = $command({
        name: "build",
        description: "Build the project",
        flags: z.object({ compile: z.boolean().default(true) }),
        handler: async () => {},
      });
    }

    const capture = () => {
      const alepha = Alepha.create()
        .with(TestCommands)
        .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });

      return {
        cli: alepha.inject(TestCliProvider),
        output: alepha.inject(MemoryOutputProvider),
        commands: alepha.inject(TestCommands),
      };
    };

    it("should document -- and --no-<flag> in command help", ({ expect }) => {
      const { cli, output, commands } = capture();

      cli.printHelp(commands.build);

      expect(output.text).toContain("--no-<flag>");
      expect(output.text).toContain("ends flag parsing");
    });

    it("should document -- and --no-<flag> in general help", ({ expect }) => {
      const { cli, output } = capture();

      cli.printHelp();

      expect(output.text).toContain("--no-<flag>");
      expect(output.text).toContain("ends flag parsing");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // --no-<flag> negation
  // ────────────────────────────────────────────────────────────────────────────

  describe("--no-<flag> negation", () => {
    it("should turn a boolean flag off", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "compile", aliases: ["compile"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["--no-compile"], flagDefs);

      expect(result.compile).toBe(false);
    });

    it("should turn an optional boolean flag off", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        {
          key: "compile",
          aliases: ["compile"],
          schema: z.boolean().default(true),
        },
      ];

      const result = cli.testParseFlags(["--no-compile"], flagDefs);

      expect(result.compile).toBe(false);
    });

    it("should reject the negation of a non-boolean flag", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: z.text() }];

      expect(() => cli.testParseFlags(["--no-name"], flagDefs)).toThrow(
        /not a boolean flag/,
      );
    });

    it("should reject a value on the negated form", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "compile", aliases: ["compile"], schema: z.boolean() },
      ];

      expect(() => cli.testParseFlags(["--no-compile=true"], flagDefs)).toThrow(
        /does not take a value/,
      );
    });

    it("should prefer a flag actually named no-<something>", ({ expect }) => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "noCache", aliases: ["no-cache"], schema: z.boolean() },
        { key: "cache", aliases: ["cache"], schema: z.boolean() },
      ];

      const result = cli.testParseFlags(["--no-cache"], flagDefs);

      expect(result.noCache).toBe(true);
      expect(result.cache).toBeUndefined();
    });

    it("should not swallow the next token as a value", ({ expect }) => {
      const cli = createTestCli();
      // A union with boolean takes the next token as its value when it is
      // not negated, so this is the flag the negation has to stop.
      const flagDefs = [
        {
          key: "image",
          aliases: ["image"],
          schema: z.union([z.boolean(), z.text()]),
        },
      ];

      expect(
        cli.testGetFlagConsumedIndices(["--image", "target"], flagDefs).has(1),
      ).toBe(true);
      expect(
        cli
          .testGetFlagConsumedIndices(["--no-image", "target"], flagDefs)
          .has(1),
      ).toBe(false);
      expect(cli.testParseFlags(["--no-image", "target"], flagDefs)).toEqual({
        image: false,
      });
    });

    it("should reach a command handler", async ({ expect }) => {
      let captured: unknown;

      class TestCommands {
        build = $command({
          name: "build",
          flags: z.object({ compile: z.boolean().default(true) }),
          handler: async ({ flags }) => {
            captured = flags.compile;
          },
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestCommands);

      await cli.run(cmd.build, "--no-compile");

      expect(captured).toBe(false);
    });
  });
});
