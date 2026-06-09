import * as fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import {
  $atom,
  $env,
  $hook,
  $inject,
  $state,
  Alepha,
  type Static,
  type TObject,
  type TSchema,
  type TUnion,
  TypeBoxError,
  t,
} from "alepha";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { CommandError } from "../errors/CommandError.ts";
import { Asker } from "../helpers/Asker.ts";
import { EnvUtils } from "../helpers/EnvUtils.ts";
import { Runner } from "../helpers/Runner.ts";
import {
  $command,
  type CommandHandlerArgs,
  type CommandPrimitive,
} from "../primitives/$command.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  CLI_NAME: t.text({
    default: "cli",
    description: "Name of the CLI application.",
  }),
  CLI_DESCRIPTION: t.text({
    default: "",
    description: "Description of the CLI application.",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * CLI provider configuration atom
 */
export const cliOptions = $atom({
  name: "alepha.command.cli.options",
  schema: t.object({
    name: t.optional(
      t.string({
        description: "Name of the CLI application.",
      }),
    ),
    description: t.optional(
      t.string({
        description: "Description of the CLI application.",
      }),
    ),
    argv: t.optional(
      t.array(t.string(), {
        description: "Command line arguments to parse.",
      }),
    ),
  }),
  default: {},
});

export type CliProviderOptions = Static<typeof cliOptions.schema>;

declare module "alepha" {
  interface State {
    [cliOptions.key]: CliProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * CLI provider for parsing and executing commands.
 *
 * Handles:
 * - Command resolution (simple, nested, colon-notation)
 * - Flag and argument parsing
 * - Environment variable validation
 * - Help generation
 * - Pre/post command hooks
 *
 * @example
 * ```typescript
 * // Define a command
 * class MyCommands {
 *   build = $command({
 *     name: "build",
 *     description: "Build the project",
 *     flags: t.object({ watch: t.optional(t.boolean()) }),
 *     handler: async ({ flags }) => { ... }
 *   });
 * }
 *
 * // CLI automatically discovers and executes commands
 * const alepha = Alepha.create().with(MyCommands);
 * ```
 */
export class CliProvider {
  // ─────────────────────────────────────────────────────────────────────────────
  // Dependencies
  // ─────────────────────────────────────────────────────────────────────────────

  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly color = $inject(ConsoleColorProvider);
  protected readonly runner = $inject(Runner);
  protected readonly asker = $inject(Asker);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly options = $state(cliOptions);

  // ─────────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────────

  protected get name(): string {
    return this.options.name || this.env.CLI_NAME;
  }

  protected get description(): string {
    return this.options.description || this.env.CLI_DESCRIPTION;
  }

  protected get argv(): string[] {
    return (
      this.options.argv ||
      (typeof process !== "undefined" ? process.argv.slice(2) : [])
    );
  }

  /**
   * Global flags available to all commands.
   */
  protected readonly globalFlags = {
    help: {
      aliases: ["h", "help"],
      description: "Show this help message",
      schema: t.boolean(),
    },
    verbose: {
      // No `-v` alias — it collides with `--version` on the root command.
      aliases: ["verbose"],
      description:
        "Verbose output: trace-level logs (framework internals) in pretty format. Task output already streams by default.",
      schema: t.boolean(),
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Main entry point - resolves and executes the command from process.argv.
   * This is the production execution path with full lifecycle support.
   */
  protected readonly onReady = $hook({
    on: "ready",
    handler: async () => {
      const argv = [...this.argv];

      // Extract positional arguments (potential command path)
      const positionalArgs = argv.filter((arg) => !arg.startsWith("-"));

      // Resolve command using space-separated or colon-notation
      const { command, consumedArgs } = this.resolveCommand(positionalArgs);

      const globalFlags = this.parseFlags(
        argv,
        Object.entries(this.getAllGlobalFlags()).map(([key, value]) => ({
          key,
          ...value,
        })),
        { strict: false }, // Don't throw for command-specific flags
      );

      // `--verbose` → raise the logger to trace + pretty format via state
      // (read live by Logger). Task output already streams to the terminal;
      // this additionally surfaces the framework's own trace/debug logs.
      //
      // An agent session (Claude Code sets CLAUDECODE) implies verbose: the
      // compact `cli` format is tuned for a human watching a terminal, but an
      // agent benefits from the full module/context and internal logs — same
      // as if `--verbose` were passed.
      const verbose = globalFlags.verbose || !!this.alepha.env.CLAUDECODE;
      if (verbose) {
        this.alepha.store.set("alepha.logger.level", "trace");
        this.alepha.store.set("alepha.logger.format", "pretty");
      }

      if (globalFlags.help) {
        this.printHelp(command);
        return;
      }

      if (!command) {
        // Check if there's a root command (name === "")
        const rootCommand = this.findCommand("");

        // If we have positional args but no matching command, show error
        const commandName = positionalArgs[0] ?? "";
        if (commandName !== "" && !rootCommand?.options.args) {
          this.log.error(`Unknown command: '${commandName}'`);
          this.printHelp();
          return;
        }

        // Execute root command if it exists
        if (rootCommand) {
          await this.executeCommand(rootCommand, argv, true);
          return;
        }

        // No command found and no root command
        return;
      }

      // Remove consumed command path args from argv for argument parsing
      const remainingArgv = this.removeConsumedArgs(argv, consumedArgs);

      // Since we've removed the command path, treat it like a root command for parsing
      await this.executeCommand(command, remainingArgv, true);
    },
  });

  /**
   * Execute a command with full lifecycle support.
   *
   * This is the production execution path that includes:
   * - Mode-based .env file loading
   * - Pre/post command hooks
   * - Runner session for pretty CLI output
   * - Alepha context wrapper for proper scoping
   *
   * @see run() for a lightweight test-only alternative
   */
  protected async executeCommand(
    command: CommandPrimitive<TObject>,
    argv: string[],
    isRootCommand: boolean,
  ): Promise<void> {
    const root = process.cwd();

    // Handle --mode flag if command has mode option enabled
    let modeValue: string | undefined;
    if (command.options.mode) {
      modeValue = this.parseModeFlag(argv);
      // Use default mode if not provided and mode is a string
      if (modeValue === undefined && typeof command.options.mode === "string") {
        modeValue = command.options.mode;
      }
      await this.loadModeEnv(root, modeValue);
    }

    const commandFlags = this.parseCommandFlags(argv, command.flags, {
      modeEnabled: !!command.options.mode,
    });
    const commandArgs = this.parseCommandArgs(
      argv,
      command.options.args,
      isRootCommand,
      command.flags,
    );
    const commandEnv = this.parseCommandEnv(command.env, command.name);

    await this.alepha.context.run(async () => {
      this.log.debug(`Executing command '${command.name}'...`, {
        flags: commandFlags,
        args: commandArgs,
        mode: modeValue,
      });

      const runner = this.runner;

      // Start command session for pretty print
      runner.startCommand(this.name, command.name);

      const args = {
        flags: commandFlags,
        args: commandArgs,
        env: commandEnv,
        run: runner.run,
        ask: this.asker.ask,
        fs,
        glob,
        root,
        help: () => this.printHelp(command),
        mode: modeValue,
      };

      // Execute pre-hooks
      const preHooks = this.findPreHooks(command.name);
      for (const hook of preHooks) {
        this.log.debug(`Executing pre-hook for '${command.name}'...`);
        await hook.options.handler(args as CommandHandlerArgs<TObject>);
      }

      // Execute main command
      await command.options.handler(args as CommandHandlerArgs<TObject>);

      // Execute post-hooks
      const postHooks = this.findPostHooks(command.name);
      for (const hook of postHooks) {
        this.log.debug(`Executing post-hook for '${command.name}'...`);
        await hook.options.handler(args as CommandHandlerArgs<TObject>);
      }

      runner.end();

      this.log.debug(`Command '${command.name}' executed successfully.`);
    });
  }

  /**
   * Remove consumed command path arguments from argv (keeps flags and remaining args).
   */
  protected removeConsumedArgs(
    argv: string[],
    consumedArgs: string[],
  ): string[] {
    const result: string[] = [];
    let consumedIndex = 0;

    for (const arg of argv) {
      if (arg.startsWith("-")) {
        result.push(arg);
      } else if (
        consumedIndex < consumedArgs.length &&
        arg === consumedArgs[consumedIndex]
      ) {
        consumedIndex++;
        // Skip this arg, it's part of the command path
      } else {
        result.push(arg);
      }
    }

    return result;
  }

  /**
   * Resolve a command from positional arguments.
   *
   * Supports:
   * 1. Space-separated subcommands: `deploy vercel` -> finds deploy command, then vercel child
   * 2. Colon notation (backwards compat): `deploy:vercel` -> finds command with name "deploy:vercel"
   * 3. Simple commands: `build` -> finds command with name "build"
   */
  protected resolveCommand(positionalArgs: string[]): {
    command: CommandPrimitive<TObject> | undefined;
    consumedArgs: string[];
  } {
    if (positionalArgs.length === 0) {
      return { command: undefined, consumedArgs: [] };
    }

    const firstArg = positionalArgs[0];

    // First, try colon notation for backwards compatibility (e.g., "deploy:vercel")
    if (firstArg.includes(":")) {
      const command = this.findCommand(firstArg);
      if (command) {
        return { command, consumedArgs: [firstArg] };
      }
    }

    // Try to find command with space-separated subcommand path
    // Only search top-level commands to avoid child commands shadowing
    // top-level ones (e.g., "platform > build" shadowing standalone "build")
    let currentCommand = this.findTopLevelCommand(firstArg);
    const consumedArgs: string[] = [];

    if (!currentCommand) {
      return { command: undefined, consumedArgs: [] };
    }

    consumedArgs.push(firstArg);

    // Walk through remaining args to find nested subcommands
    for (let i = 1; i < positionalArgs.length; i++) {
      const arg = positionalArgs[i];

      if (!currentCommand.hasChildren) {
        break;
      }

      const childCommand = currentCommand.findChild(arg);
      if (childCommand) {
        currentCommand = childCommand;
        consumedArgs.push(arg);
      } else {
        // No matching child, stop here
        break;
      }
    }

    return { command: currentCommand, consumedArgs };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get all registered commands in the application.
   */
  public get commands(): CommandPrimitive<any>[] {
    return this.alepha.primitives($command);
  }

  /**
   * Execute a command handler with given arguments.
   *
   * This is a **lightweight test helper** that directly invokes the command handler
   * without the full production lifecycle. It intentionally skips:
   * - Pre/post command hooks
   * - Runner session (pretty CLI output)
   * - Alepha context wrapper
   * - .env.{mode} file loading
   *
   * For production execution, the `onReady` hook uses `executeCommand()` which
   * provides the full lifecycle. Merging them would either make this method too
   * heavy for simple testing or require many optional parameters to toggle behaviors.
   *
   * @example
   * ```typescript
   * // In tests
   * const cli = alepha.inject(CliProvider);
   * const cmd = alepha.inject(InitCommand);
   *
   * await cli.run(cmd.init, "--agent --pm=yarn");
   * await cli.run(cmd.init, { argv: "--agent", root: "/project" });
   * ```
   */
  public async run<T extends TObject, A extends TSchema>(
    command: CommandPrimitive<T, A>,
    options:
      | string
      | string[]
      | { argv?: string | string[]; root?: string } = {},
  ): Promise<void> {
    const opts =
      typeof options === "string" || Array.isArray(options)
        ? { argv: options }
        : options;
    const args =
      typeof opts.argv === "string"
        ? opts.argv.split(" ").filter(Boolean)
        : (opts.argv ?? []);
    const root = opts.root ?? process.cwd();

    const commandFlags = this.parseCommandFlags(args, command.flags, {
      modeEnabled: !!command.options.mode,
    });
    const commandArgs = this.parseCommandArgs(
      args,
      command.options.args,
      true,
      command.flags,
    );
    const commandEnv = this.parseCommandEnv(command.env, command.name);

    let modeValue: string | undefined;
    if (command.options.mode) {
      modeValue = this.parseModeFlag(args);
      if (modeValue === undefined && typeof command.options.mode === "string") {
        modeValue = command.options.mode;
      }
    }

    await command.options.handler({
      flags: commandFlags,
      args: commandArgs,
      env: commandEnv,
      run: this.runner.run,
      ask: this.asker.ask,
      fs,
      glob,
      root,
      help: () => this.printHelp(command),
      mode: modeValue,
    } as CommandHandlerArgs<T, A>);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Command Resolution
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find a command by name or alias
   */
  protected findCommand(name: string): CommandPrimitive<TObject> | undefined {
    return this.commands.findLast(
      (command) => command.name === name || command.aliases.includes(name),
    );
  }

  /**
   * Find a top-level command by name or alias (excludes child commands)
   */
  protected findTopLevelCommand(
    name: string,
  ): CommandPrimitive<TObject> | undefined {
    return this.getTopLevelCommands().findLast(
      (command) => command.name === name || command.aliases.includes(name),
    );
  }

  /**
   * Find all pre-hooks for a command (commands named `pre{commandName}`)
   */
  protected findPreHooks(commandName: string): CommandPrimitive<TObject>[] {
    return this.commands.filter((cmd) => cmd.name === `pre${commandName}`);
  }

  /**
   * Find all post-hooks for a command (commands named `post{commandName}`)
   */
  protected findPostHooks(commandName: string): CommandPrimitive<TObject>[] {
    return this.commands.filter((cmd) => cmd.name === `post${commandName}`);
  }

  /**
   * Get global flags (help only, root command flags are NOT global)
   */
  protected getAllGlobalFlags(): Record<
    string,
    { aliases: string[]; description?: string; schema: TSchema }
  > {
    return { ...this.globalFlags };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Parsing (Flags, Args, Env)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parse command flags from argv using the command's flag schema
   */
  protected parseCommandFlags(
    argv: string[],
    schema: TObject,
    options: { modeEnabled?: boolean } = {},
  ): Record<string, any> {
    const { modeEnabled = false } = options;
    const flagDefs = Object.entries(schema.properties).map(([key, value]) => ({
      key,
      aliases: [
        key,
        ...((value as any).aliases ??
          ((value as any).alias ? [(value as any).alias] : undefined) ??
          []),
      ],
      description: (value as any).description,
      schema: value,
    }));

    // Add mode flags if mode is enabled (they're parsed elsewhere by parseModeFlag)
    if (modeEnabled) {
      flagDefs.push({
        key: "__mode__",
        aliases: ["mode", "m"],
        description: undefined,
        schema: t.string(),
      });
    }

    // Tolerate global flags (--help, --verbose) so strict command parsing
    // doesn't reject them — they're consumed by the onReady global pass,
    // not by the command. Skip any whose alias the command already claims
    // (e.g. a command with its own `verbose` flag handles it directly).
    const claimed = new Set(flagDefs.flatMap((d) => d.aliases));
    for (const [key, value] of Object.entries(this.getAllGlobalFlags())) {
      if (value.aliases.some((a: string) => claimed.has(a))) continue;
      flagDefs.push({
        key: `__global_${key}__`,
        aliases: value.aliases,
        description: undefined,
        schema: value.schema,
      });
    }

    const parsed = this.parseFlags(argv, flagDefs);

    // Remove the mode + global flags from parsed result (handled separately)
    parsed.__mode__ = undefined;
    for (const key of Object.keys(parsed)) {
      if (key.startsWith("__global_")) delete parsed[key];
    }

    // apply manually defaults for optional properties that have defaults
    for (const [key, value] of Object.entries(schema.properties)) {
      if (!(key in parsed) && t.schema.isOptional(value)) {
        const innerSchema = value;
        if (innerSchema && "default" in innerSchema) {
          parsed[key] = innerSchema.default;
        }
      }
    }

    try {
      return this.alepha.codec.decode(schema, parsed);
    } catch (error) {
      if (error instanceof TypeBoxError) {
        throw new CommandError(
          `Invalid flag: ${error.cause.instancePath || "command"} ${error.cause.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Parse and validate environment variables using the command's env schema
   */
  protected parseCommandEnv(
    schema: TObject,
    commandName: string,
  ): Record<string, any> {
    const result: Record<string, any> = {};
    const missing: string[] = [];

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = process.env[key];

      if (value !== undefined) {
        result[key] = value;
      } else if ("default" in propSchema) {
        result[key] = propSchema.default;
      } else if (t.schema.isOptional(propSchema)) {
        // Optional with no default — leave undefined
      } else {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      const vars = missing.join(", ");
      throw new CommandError(
        `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${vars}`,
      );
    }

    try {
      return this.alepha.codec.decode(schema, result);
    } catch (error) {
      if (error instanceof TypeBoxError) {
        throw new CommandError(
          `Invalid environment variable: ${error.cause.instancePath || "env"} ${error.cause.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Parse --mode or -m flag from argv for environment file loading
   */
  protected parseModeFlag(argv: string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];

      // Handle --mode=value or -m=value
      if (arg.startsWith("--mode=") || arg.startsWith("-m=")) {
        return arg.split("=")[1];
      }

      // Handle --mode value or -m value
      if (arg === "--mode" || arg === "-m") {
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          return nextArg;
        }
        throw new CommandError("Flag --mode requires a value.");
      }
    }

    return undefined;
  }

  /**
   * Load .env and .env.{mode} files into process.env
   */
  protected async loadModeEnv(
    root: string,
    mode: string | undefined,
  ): Promise<void> {
    const envFiles = [".env"];
    if (mode) {
      envFiles.push(`.env.${mode}`);
    }
    this.log.debug(`Loading env files: ${envFiles.join(", ")}`);
    await this.envUtils.loadEnv(root, envFiles);
  }

  /**
   * Low-level flag parser - extracts flag values from argv based on definitions
   */
  protected parseFlags(
    argv: string[],
    flagDefs: { key: string; aliases: string[]; schema: TSchema }[],
    options: { strict?: boolean } = {},
  ): Record<string, any> {
    const { strict = true } = options;
    const result: Record<string, any> = {};

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (!arg.startsWith("-")) continue;

      const [rawKey, ...valueParts] = arg.replace(/^-{1,2}/, "").split("=");
      let value = valueParts.join("=");

      const def = flagDefs.find((d) => d.aliases.includes(rawKey));
      if (!def) {
        if (strict) {
          throw new CommandError(`Unknown flag: --${rawKey}`);
        }
        continue;
      }

      // Check if schema is a union containing boolean (allows flag without value)
      const isUnionWithBoolean =
        t.schema.isUnion(def.schema) &&
        (def.schema as TUnion).anyOf.some((s) => t.schema.isBoolean(s));

      if (t.schema.isBoolean(def.schema)) {
        result[def.key] = true;
      } else if (isUnionWithBoolean && !value) {
        // Union with boolean: --flag without value → true
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          // Has a value after space: --flag value
          result[def.key] = nextArg;
          i++; // consume next arg
        } else {
          // No value: --flag → true
          result[def.key] = true;
        }
      } else if (value) {
        // Value provided via --flag=value syntax
        try {
          if (t.schema.isObject(def.schema) || t.schema.isArray(def.schema)) {
            result[def.key] = JSON.parse(value);
          } else {
            result[def.key] = value;
          }
        } catch {
          throw new CommandError(`Invalid JSON value for flag --${rawKey}`);
        }
      } else {
        // Check for space-separated value: --flag value
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          value = nextArg;
          try {
            if (t.schema.isObject(def.schema) || t.schema.isArray(def.schema)) {
              result[def.key] = JSON.parse(value);
            } else {
              result[def.key] = value;
            }
          } catch {
            throw new CommandError(`Invalid JSON value for flag --${rawKey}`);
          }
        } else {
          throw new CommandError(`Flag --${rawKey} requires a value.`);
        }
      }
    }

    return result;
  }

  /**
   * Get indices of argv elements consumed by flags (for separating args from flags)
   */
  protected getFlagConsumedIndices(
    argv: string[],
    flagDefs: { key: string; aliases: string[]; schema: TSchema }[],
  ): Set<number> {
    const consumed = new Set<number>();

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (!arg.startsWith("-")) continue;

      consumed.add(i);

      const [rawKey, ...valueParts] = arg.replace(/^-{1,2}/, "").split("=");
      const hasEqualValue = valueParts.length > 0;

      const def = flagDefs.find((d) => d.aliases.includes(rawKey));
      if (!def) continue;

      // Check if schema is a union containing boolean
      const isUnionWithBoolean =
        t.schema.isUnion(def.schema) &&
        (def.schema as TUnion).anyOf.some((s) => t.schema.isBoolean(s));

      // If not a boolean flag and no = value, the next arg is consumed as the value
      // Exception: union with boolean can work without a value
      if (
        !t.schema.isBoolean(def.schema) &&
        !isUnionWithBoolean &&
        !hasEqualValue
      ) {
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          consumed.add(i + 1);
        }
      } else if (isUnionWithBoolean && !hasEqualValue) {
        // Union with boolean: check if next arg looks like a value (not a flag)
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          consumed.add(i + 1);
        }
      }
    }

    return consumed;
  }

  protected parseCommandArgs(
    argv: string[],
    schema?: TSchema,
    isRootCommand = false,
    flagSchema?: TObject,
  ): any {
    if (!schema) {
      return undefined;
    }

    // Get indices consumed by flags (including space-separated values)
    const flagDefs = flagSchema
      ? Object.entries(flagSchema.properties).map(([key, value]) => ({
          key,
          aliases: [
            key,
            ...((value as any).aliases ??
              ((value as any).alias ? [(value as any).alias] : undefined) ??
              []),
          ],
          schema: value as TSchema,
        }))
      : [];
    const consumedIndices = this.getFlagConsumedIndices(argv, flagDefs);

    // Extract positional arguments (non-flag arguments that aren't consumed as flag values)
    const positionalArgs = argv.filter(
      (arg, idx) => !arg.startsWith("-") && !consumedIndices.has(idx),
    );
    // For root commands, there's no command name to remove; otherwise slice off the command name
    const argsOnly = isRootCommand ? positionalArgs : positionalArgs.slice(1);

    try {
      if (t.schema.isOptional(schema)) {
        // Handle optional args: t.optional(t.text())
        if (argsOnly.length === 0) {
          return undefined;
        }
        return this.parseArgumentValue(argsOnly[0], schema);
      } else if (t.schema.isTuple(schema) && schema.items) {
        // Handle tuple args: t.tuple([t.text(), t.number()])
        const result: any[] = [];
        const items = schema.items;
        for (let i = 0; i < items.length; i++) {
          const itemSchema = items[i];
          if (i < argsOnly.length) {
            result.push(this.parseArgumentValue(argsOnly[i], itemSchema));
          } else if (t.schema.isOptional(itemSchema)) {
            result.push(undefined);
          } else {
            throw new CommandError(
              `Missing required argument at position ${i + 1}`,
            );
          }
        }
        return result;
      } else {
        // Handle single arg: t.text(), t.number(), etc.
        if (argsOnly.length === 0) {
          throw new CommandError("Missing required argument");
        }
        return this.parseArgumentValue(argsOnly[0], schema);
      }
    } catch (error) {
      if (error instanceof TypeBoxError) {
        throw new CommandError(`Invalid argument: ${error.value.message}`);
      }
      throw error;
    }
  }

  /**
   * Convert a string argument value to the appropriate type based on schema
   */
  protected parseArgumentValue(value: string, schema: TSchema): any {
    if (t.schema.isString(schema)) {
      return value;
    }

    if (t.schema.isNumber(schema) || t.schema.isInteger(schema)) {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new CommandError(`Expected number, got "${value}"`);
      }
      if (t.schema.isInteger(schema) && !Number.isInteger(num)) {
        throw new CommandError(`Expected integer, got "${value}"`);
      }
      return num;
    }

    if (t.schema.isBoolean(schema)) {
      const lower = value.toLowerCase();
      if (lower === "true" || lower === "1") return true;
      if (lower === "false" || lower === "0") return false;
      throw new CommandError(`Expected boolean, got "${value}"`);
    }

    // For other types, return the string value and let TypeBox validate it
    return value;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Help Generation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate usage string for command arguments (e.g., "<path>" or "[path]")
   */
  protected generateArgsUsage(schema?: TSchema): string {
    if (!schema) {
      return "";
    }

    if (t.schema.isOptional(schema)) {
      const typeName = this.getTypeName(schema);
      const key = "title" in schema ? (schema as any).title : "arg1";
      return ` [${key}${typeName}]`;
    }

    if (t.schema.isTuple(schema) && schema.items) {
      const items = schema.items;
      const args = items.map((item, index) => {
        const argName = `arg${index + 1}`;
        const typeName = this.getTypeName(item);
        if (t.schema.isOptional(item)) {
          return `[${argName}${typeName}]`;
        }
        return `<${argName}${typeName}>`;
      });
      return ` ${args.join(" ")}`;
    }

    const typeName = this.getTypeName(schema);
    const key = "title" in schema ? (schema as any).title : "arg1";
    return ` <${key}${typeName}>`;
  }

  /**
   * Get display type name for a schema (e.g., ": number", ": boolean")
   */
  protected getTypeName(schema: TSchema): string {
    if (!schema) return "";

    // Check TypeBox type guards first
    if (t.schema.isString(schema)) return "";
    if (t.schema.isNumber(schema)) return ": number";
    if (t.schema.isInteger(schema)) return ": integer";
    if (t.schema.isBoolean(schema)) return ": boolean";

    return "";
  }

  /**
   * Print help for a specific command or general CLI help.
   *
   * @param command - If provided, shows help for this specific command.
   *                  If omitted, shows general CLI help with all commands.
   */
  public printHelp(command?: CommandPrimitive<any>): void {
    // Help is a document, not a log stream: render bare lines (no timestamp
    // or level prefix). Embedded colors live in the message itself, so they
    // survive the `raw` formatter.
    this.alepha.store.set("alepha.logger.format", "raw");

    const cliName = this.name || "cli";
    const c = this.color;
    this.log.info(""); // Newline

    if (command?.name) {
      // Command-specific help
      const hasChildren = command.hasChildren;
      const argsUsage = hasChildren
        ? ` ${c.set("CYAN", "<command>")}`
        : this.generateColoredArgsUsage(command.options.args);
      const commandPath = this.getCommandPath(command);
      const usage =
        `${c.set("GREY_LIGHT", cliName)} ${c.set("CYAN", commandPath)}${argsUsage}`.trim();
      this.log.info(`${c.set("WHITE_BOLD", "Usage:")} ${usage}`);

      if (command.options.description) {
        this.log.info(``);
        this.log.info(`\t${command.options.description}`);
      }

      // Show subcommands if this is a parent command
      if (hasChildren) {
        this.log.info("");
        this.log.info(c.set("WHITE_BOLD", "Commands:"));
        const maxSubCmdLength = this.getMaxChildCmdLength(command.children);

        for (const child of command.children) {
          if (child.options.hide) {
            continue;
          }
          const childArgsUsage = this.generateArgsUsage(child.options.args);
          const cmdStr = [child.name, ...child.aliases].join(", ");
          const fullCmdStr = `${cmdStr}${childArgsUsage}`;
          const coloredCmd = `${c.set("GREY_LIGHT", cliName)} ${c.set("CYAN", commandPath)} ${c.set("CYAN", fullCmdStr)}`;
          const padding = " ".repeat(
            Math.max(0, maxSubCmdLength - fullCmdStr.length),
          );
          this.log.info(
            `    ${coloredCmd}${padding}  ${child.options.description ?? ""}`,
          );
        }
      }

      this.log.info("");
      this.log.info(c.set("WHITE_BOLD", "Flags:"));

      const flags = [
        ...Object.entries(command.flags.properties).map(([key, value]) => ({
          key,
          schema: value,
          aliases: [
            key,
            ...((value as any).aliases ??
              ((value as any).alias ? [(value as any).alias] : [])),
          ],
          description: (value as any).description,
        })),
        // Add --mode flag if command has mode option enabled
        ...(command.options.mode
          ? [
              {
                key: "mode",
                aliases: ["m", "mode"],
                description:
                  typeof command.options.mode === "string"
                    ? `Environment mode - loads .env.{mode} (default: ${command.options.mode})`
                    : "Environment mode (e.g., production, staging) - loads .env.{mode}",
                schema: t.string() as TSchema,
              },
            ]
          : []),
        ...Object.entries(this.getAllGlobalFlags()).map(([key, value]) => ({
          key,
          ...value,
        })),
      ];

      const maxFlagLength = this.getMaxFlagLength(flags);
      for (const flag of flags) {
        const { aliases, description } = flag;
        const schema = "schema" in flag ? (flag.schema as TSchema) : undefined;
        // Sort aliases by length (shorter first: -t before --target)
        const sortedAliases = (Array.isArray(aliases) ? aliases : [aliases])
          .slice()
          .sort((a, b) => a.length - b.length);
        const flagStr = sortedAliases
          .map((a: string) => (a.length === 1 ? `-${a}` : `--${a}`))
          .join(", ");
        const coloredFlag = c.set("GREY_LIGHT", flagStr);
        const padding = " ".repeat(Math.max(0, maxFlagLength - flagStr.length));
        const formattedDesc = this.formatFlagDescription(description, schema);
        this.log.info(`    ${coloredFlag}${padding}  ${formattedDesc}`);
      }

      // Show environment variables if defined
      const envVars = Object.entries(command.env.properties);
      if (envVars.length > 0) {
        this.log.info("");
        this.log.info(c.set("WHITE_BOLD", "Env:"));
        const maxEnvLength = Math.max(...envVars.map(([key]) => key.length));
        for (const [key, schema] of envVars) {
          const isOptional = t.schema.isOptional(schema as TSchema);
          const description = (schema as any).description ?? "";
          const optionalStr = isOptional
            ? c.set("GREY_DARK", " (optional)")
            : c.set("RED", " (required)");
          const coloredKey = c.set("CYAN", key);
          const padding = " ".repeat(Math.max(0, maxEnvLength - key.length));
          this.log.info(
            `    ${coloredKey}${padding}  ${description}${optionalStr}`,
          );
        }
      }
    } else {
      // general help
      this.log.info(this.description || "Available commands:");
      this.log.info("");
      this.log.info(c.set("WHITE_BOLD", "Commands:"));

      // Get top-level commands (commands that are not children of other commands)
      const topLevelCommands = this.getTopLevelCommands();
      const maxCmdLength = this.getMaxCmdLength(topLevelCommands);

      for (const cmd of topLevelCommands) {
        // skip root command and hooks in list
        if (cmd.name === "" || cmd.options.hide) {
          continue;
        }

        const cmdStr = [cmd.name, ...cmd.aliases].join(", ");
        const argsUsage = cmd.hasChildren
          ? " <command>"
          : this.generateArgsUsage(cmd.options.args);
        const fullCmdStr = `${cmdStr}${argsUsage}`;
        const coloredCmd = `${c.set("GREY_LIGHT", cliName)} ${c.set("CYAN", fullCmdStr)}`;
        const padding = " ".repeat(
          Math.max(0, maxCmdLength - fullCmdStr.length),
        );
        this.log.info(
          `    ${coloredCmd}${padding}  ${cmd.options.description ?? ""}`,
        );
      }

      this.log.info("");
      this.log.info(c.set("WHITE_BOLD", "Flags:"));

      // In general help, also show root command flags
      const rootCommand = this.commands.find((cmd) => cmd.name === "");
      const rootFlags = rootCommand
        ? Object.entries(rootCommand.flags.properties).map(([key, value]) => ({
            key,
            aliases: [
              key,
              ...((value as any).aliases ??
                ((value as any).alias ? [(value as any).alias] : undefined) ??
                []),
            ],
            description: (value as any).description,
            schema: value as TSchema,
          }))
        : [];

      const globalFlags = [
        ...rootFlags,
        ...Object.values(this.getAllGlobalFlags()),
      ];
      const maxFlagLength = this.getMaxFlagLength(globalFlags);
      for (const { aliases, description, schema } of globalFlags) {
        const flagStr = aliases
          .map((a) => (a.length === 1 ? `-${a}` : `--${a}`))
          .join(", ");
        const coloredFlag = c.set("GREY_LIGHT", flagStr);
        const padding = " ".repeat(Math.max(0, maxFlagLength - flagStr.length));
        const formattedDesc = this.formatFlagDescription(description, schema);
        this.log.info(`    ${coloredFlag}${padding}  ${formattedDesc}`);
      }
    }
    this.log.info(""); // Newline
  }

  /**
   * Generate colored usage string for command arguments (for help display)
   */
  protected generateColoredArgsUsage(schema?: TSchema): string {
    if (!schema) {
      return "";
    }

    const c = this.color;

    if (t.schema.isOptional(schema)) {
      const typeName = this.getTypeName(schema);
      const key = "title" in schema ? (schema as any).title : "arg1";
      return ` ${c.set("GREY_DARK", `[${key}${typeName}]`)}`;
    }

    if (t.schema.isTuple(schema) && schema.items) {
      const items = schema.items;
      const args = items.map((item, index) => {
        const argName = `arg${index + 1}`;
        const typeName = this.getTypeName(item);
        if (t.schema.isOptional(item)) {
          return c.set("GREY_DARK", `[${argName}${typeName}]`);
        }
        return c.set("CYAN", `<${argName}${typeName}>`);
      });
      return ` ${args.join(" ")}`;
    }

    const typeName = this.getTypeName(schema);
    const key = "title" in schema ? (schema as any).title : "arg1";
    return ` ${c.set("CYAN", `<${key}${typeName}>`)}`;
  }

  /**
   * Get the full command path (e.g., "deploy vercel" for a nested command)
   */
  protected getCommandPath(command: CommandPrimitive<any>): string {
    const path: string[] = [command.name];
    let current = command;

    // Walk up the tree to find parents
    while (true) {
      const parent = this.findParentCommand(current);
      if (!parent) break;
      path.unshift(parent.name);
      current = parent;
    }

    return path.join(" ");
  }

  /**
   * Find the parent command of a nested command
   */
  protected findParentCommand(
    command: CommandPrimitive<any>,
  ): CommandPrimitive<any> | undefined {
    for (const cmd of this.commands) {
      if (cmd.children.includes(command)) {
        return cmd;
      }
    }
    return undefined;
  }

  /**
   * Get top-level commands (commands that are not children of other commands)
   */
  protected getTopLevelCommands(): CommandPrimitive<any>[] {
    const allChildren = new Set<CommandPrimitive<any>>();

    // Collect all children
    for (const command of this.commands) {
      for (const child of command.children) {
        allChildren.add(child);
      }
    }

    // Return commands that are not children
    return this.commands.filter((cmd) => !allChildren.has(cmd));
  }

  /**
   * Calculate max display length for child commands (for help alignment)
   */
  protected getMaxChildCmdLength(children: CommandPrimitive<any>[]): number {
    return Math.max(
      ...children
        .filter((c) => !c.options.hide)
        .map((c) => {
          const cmdStr = [c.name, ...c.aliases].join(", ");
          const argsUsage = this.generateArgsUsage(c.options.args);
          return `${cmdStr}${argsUsage}`.length;
        }),
      0,
    );
  }

  /**
   * Calculate max display length for commands (for help alignment)
   */
  protected getMaxCmdLength(commands: CommandPrimitive[]): number {
    return Math.max(
      ...commands
        .filter((c) => !c.options.hide && c.name !== "")
        .map((c) => {
          const cmdStr = [c.name, ...c.aliases].join(", ");
          const argsUsage = c.hasChildren
            ? " <command>"
            : this.generateArgsUsage(c.options.args);
          return `${cmdStr}${argsUsage}`.length;
        }),
    );
  }

  /**
   * Calculate max display length for flags (for help alignment)
   */
  protected getMaxFlagLength(flags: { aliases: string[] }[]): number {
    return Math.max(
      ...flags.map((f) => {
        const aliases = Array.isArray(f.aliases) ? f.aliases : [f.aliases];
        return aliases
          .map((a) => (a.length === 1 ? `-${a}` : `--${a}`))
          .join(", ").length;
      }),
    );
  }

  /**
   * Extract enum values from a schema if it represents an enum.
   * Returns undefined if the schema is not an enum.
   */
  protected getEnumValues(schema: TSchema): string[] | undefined {
    if (!schema) return undefined;

    // Check if schema has an enum property (t.enum creates schemas with this)
    if (
      "enum" in schema &&
      Array.isArray(schema.enum) &&
      schema.enum.every((v) => typeof v === "string")
    ) {
      return schema.enum as string[];
    }

    // Also check for union of string literals (alternative enum representation)
    if (t.schema.isUnion(schema)) {
      const union = schema as TUnion;
      const values: string[] = [];

      for (const variant of union.anyOf) {
        // Check if the variant is a string literal (has const property)
        if (
          t.schema.isString(variant) &&
          "const" in variant &&
          typeof variant.const === "string"
        ) {
          values.push(variant.const);
        } else {
          // Not all variants are string literals, not a simple enum
          return undefined;
        }
      }

      return values.length > 0 ? values : undefined;
    }

    return undefined;
  }

  /**
   * Format flag description with enum values if applicable.
   */
  protected formatFlagDescription(
    description: string | undefined,
    schema: TSchema | undefined,
  ): string {
    const baseDesc = description ?? "";

    if (!schema) return baseDesc;

    const enumValues = this.getEnumValues(schema);
    if (enumValues && enumValues.length > 0) {
      const valuesStr = enumValues.join(", ");
      const c = this.color;
      const enumHint = c.set("GREY_DARK", `[${valuesStr}]`);
      return baseDesc ? `${baseDesc} ${enumHint}` : enumHint;
    }

    return baseDesc;
  }
}
