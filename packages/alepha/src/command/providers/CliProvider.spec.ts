import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $command } from "../primitives/$command.ts";
import { CliProvider } from "./CliProvider.ts";

/**
 * Test subclass that exposes protected methods for unit testing.
 */
class TestCliProvider extends CliProvider {
  public testParseFlags = this.parseFlags.bind(this);
  public testParseCommandArgs = this.parseCommandArgs.bind(this);
  public testParseArgumentValue = this.parseArgumentValue.bind(this);
  public testParseModeFlag = this.parseModeFlag.bind(this);
  public testResolveCommand = this.resolveCommand.bind(this);
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
}

describe("CliProvider", () => {
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
        { key: "verbose", aliases: ["v", "verbose"], schema: t.boolean() },
      ];

      const result = cli.testParseFlags(["--verbose"], flagDefs);
      expect(result.verbose).toBe(true);
    });

    it("should parse short boolean flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "verbose", aliases: ["v", "verbose"], schema: t.boolean() },
      ];

      const result = cli.testParseFlags(["-v"], flagDefs);
      expect(result.verbose).toBe(true);
    });

    it("should parse string flags with = syntax", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "name", aliases: ["n", "name"], schema: t.string() },
      ];

      const result = cli.testParseFlags(["--name=hello"], flagDefs);
      expect(result.name).toBe("hello");
    });

    it("should parse string flags with space syntax", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "name", aliases: ["n", "name"], schema: t.string() },
      ];

      const result = cli.testParseFlags(["--name", "hello"], flagDefs);
      expect(result.name).toBe("hello");
    });

    it("should parse JSON object flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "config", aliases: ["config"], schema: t.object({}) },
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
        { key: "items", aliases: ["items"], schema: t.array(t.string()) },
      ];

      const result = cli.testParseFlags(["--items", '["a","b"]'], flagDefs);
      expect(result.items).toEqual(["a", "b"]);
    });

    it("should ignore unknown flags", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "known", aliases: ["known"], schema: t.boolean() },
      ];

      const result = cli.testParseFlags(["--unknown", "--known"], flagDefs);
      expect(result.known).toBe(true);
      expect(result.unknown).toBeUndefined();
    });

    it("should throw on missing required value", () => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: t.string() }];

      expect(() => cli.testParseFlags(["--name"], flagDefs)).toThrow(
        "requires a value",
      );
    });

    it("should throw on invalid JSON", () => {
      const cli = createTestCli();
      const flagDefs = [
        { key: "config", aliases: ["config"], schema: t.object({}) },
      ];

      expect(() =>
        cli.testParseFlags(["--config", "{invalid}"], flagDefs),
      ).toThrow("Invalid JSON");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // parseArgumentValue
  // ─────────────────────────────────────────────────────────────────────────────

  describe("parseArgumentValue", () => {
    it("should parse string values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("hello", t.string())).toBe("hello");
    });

    it("should parse number values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("42", t.number())).toBe(42);
      expect(cli.testParseArgumentValue("3.14", t.number())).toBe(3.14);
    });

    it("should throw on invalid number", () => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("abc", t.number())).toThrow(
        "Expected number",
      );
    });

    it("should parse integer values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("42", t.integer())).toBe(42);
    });

    it("should throw on non-integer for integer schema", () => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("3.14", t.integer())).toThrow(
        "Expected integer",
      );
    });

    it("should parse boolean true values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("true", t.boolean())).toBe(true);
      expect(cli.testParseArgumentValue("1", t.boolean())).toBe(true);
    });

    it("should parse boolean false values", () => {
      const cli = createTestCli();
      expect(cli.testParseArgumentValue("false", t.boolean())).toBe(false);
      expect(cli.testParseArgumentValue("0", t.boolean())).toBe(false);
    });

    it("should throw on invalid boolean", () => {
      const cli = createTestCli();
      expect(() => cli.testParseArgumentValue("yes", t.boolean())).toThrow(
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
      const schema = t.optional(t.string());
      expect(cli.testParseCommandArgs(["hello"], schema, true)).toBe("hello");
    });

    it("should return undefined for optional args when missing", () => {
      const cli = createTestCli();
      const schema = t.optional(t.string());
      expect(cli.testParseCommandArgs([], schema, true)).toBeUndefined();
    });

    it("should parse required args", () => {
      const cli = createTestCli();
      const schema = t.string();
      expect(cli.testParseCommandArgs(["hello"], schema, true)).toBe("hello");
    });

    it("should throw on missing required args", () => {
      const cli = createTestCli();
      const schema = t.string();
      expect(() => cli.testParseCommandArgs([], schema, true)).toThrow(
        "Missing required argument",
      );
    });

    it("should parse tuple args", () => {
      const cli = createTestCli();
      const schema = t.tuple([t.string(), t.number()]);
      const result = cli.testParseCommandArgs(["hello", "42"], schema, true);
      expect(result).toEqual(["hello", 42]);
    });

    it("should handle optional tuple items", () => {
      const cli = createTestCli();
      const schema = t.tuple([t.string(), t.optional(t.number())]);
      const result = cli.testParseCommandArgs(["hello"], schema, true);
      expect(result).toEqual(["hello", undefined]);
    });

    it("should skip flags when parsing args", () => {
      const cli = createTestCli();
      const schema = t.string();
      const flags = t.object({ verbose: t.optional(t.boolean()) });
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
      const schema = t.string();
      const flags = t.object({ name: t.optional(t.string()) });
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
          flags: t.object({}),
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
          flags: t.object({}),
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
        { key: "verbose", aliases: ["v", "verbose"], schema: t.boolean() },
      ];

      const result = cli.testGetFlagConsumedIndices(["--verbose"], flagDefs);
      expect(result.has(0)).toBe(true);
    });

    it("should mark flag value indices as consumed", () => {
      const cli = createTestCli();
      const flagDefs = [{ key: "name", aliases: ["name"], schema: t.string() }];

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
      const flagDefs = [{ key: "name", aliases: ["name"], schema: t.string() }];

      const result = cli.testGetFlagConsumedIndices(
        ["--name=value", "arg"],
        flagDefs,
      );
      expect(result.has(0)).toBe(true); // --name=value
      expect(result.has(1)).toBe(false); // arg
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
      const schema = t.optional(t.string({ title: "path" }));
      expect(cli.testGenerateArgsUsage(schema)).toBe(" [path]");
    });

    it("should generate required arg usage", () => {
      const cli = createTestCli();
      const schema = t.string({ title: "path" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <path>");
    });

    it("should generate tuple arg usage", () => {
      const cli = createTestCli();
      const schema = t.tuple([t.string(), t.optional(t.number())]);
      const result = cli.testGenerateArgsUsage(schema);
      expect(result).toContain("<arg1>");
      expect(result).toContain("[arg2");
    });

    it("should include type for numbers", () => {
      const cli = createTestCli();
      const schema = t.number({ title: "count" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <count: number>");
    });

    it("should include type for integers", () => {
      const cli = createTestCli();
      const schema = t.integer({ title: "port" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <port: integer>");
    });

    it("should include type for booleans", () => {
      const cli = createTestCli();
      const schema = t.boolean({ title: "force" });
      expect(cli.testGenerateArgsUsage(schema)).toBe(" <force: boolean>");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTypeName
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getTypeName", () => {
    it("should return empty for string", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(t.string())).toBe("");
    });

    it("should return ': number' for number", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(t.number())).toBe(": number");
    });

    it("should return ': integer' for integer", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(t.integer())).toBe(": integer");
    });

    it("should return ': boolean' for boolean", () => {
      const cli = createTestCli();
      expect(cli.testGetTypeName(t.boolean())).toBe(": boolean");
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
      const schema = t.optional(t.string({ title: "path" }));
      const result = cli.testGenerateColoredArgsUsage(schema);
      expect(result).toContain("[path]");
    });

    it("should generate colored required arg usage", () => {
      const cli = createTestCli();
      const schema = t.string({ title: "path" });
      const result = cli.testGenerateColoredArgsUsage(schema);
      expect(result).toContain("<path>");
    });

    it("should generate colored tuple arg usage", () => {
      const cli = createTestCli();
      const schema = t.tuple([t.string(), t.optional(t.number())]);
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
          flags: t.object({}),
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
          flags: t.object({}),
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
          flags: t.object({}),
          handler: async () => {},
        });
        build = $command({
          name: "build",
          flags: t.object({}),
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
          flags: t.object({}),
          handler: async () => {},
        });
        postBuild = $command({
          name: "postbuild",
          flags: t.object({}),
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
          flags: t.object({}),
          handler: async () => {},
        });
        test = $command({
          name: "test",
          flags: t.object({}),
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
          flags: t.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          flags: t.object({}),
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
          flags: t.object({}),
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
          flags: t.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          flags: t.object({}),
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
          flags: t.object({}),
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
          flags: t.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          flags: t.object({}),
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
          flags: t.object({}),
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
          flags: t.object({
            watch: t.optional(t.boolean({ description: "Watch for changes" })),
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
          flags: t.object({}),
          handler: async () => {},
        });
        deploy = $command({
          name: "deploy",
          description: "Deploy commands",
          flags: t.object({}),
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
          flags: t.object({}),
          env: t.object({
            API_KEY: t.string({ description: "API key for deployment" }),
            REGION: t.optional(t.string({ description: "Target region" })),
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
          flags: t.object({}),
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
          flags: t.object({}),
          args: t.string({ title: "name" }),
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
          flags: t.object({}),
          handler: async () => {},
        });
        hidden = $command({
          name: "hidden",
          description: "Hidden command",
          hide: true,
          flags: t.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create().with(TestCommands);
      const cli = alepha.inject(TestCliProvider);

      // Just verify it doesn't throw - hidden commands filtered in getTopLevelCommands
      expect(() => cli.printHelp()).not.toThrow();
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
          flags: t.object({}),
          handler: async () => {},
        });
        test = $command({
          name: "test",
          flags: t.object({}),
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
  // run (test helper)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("run", () => {
    it("should execute command with string args", async () => {
      let capturedFlags: Record<string, unknown> = {};

      class TestCommands {
        build = $command({
          name: "build",
          flags: t.object({
            watch: t.optional(t.boolean()),
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
          flags: t.object({
            name: t.optional(t.string()),
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
          flags: t.object({}),
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
          flags: t.object({}),
          args: t.string(),
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
