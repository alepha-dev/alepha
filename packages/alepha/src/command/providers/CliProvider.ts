import * as fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import {
  $atom,
  $env,
  $hook,
  $inject,
  $store,
  Alepha,
  type Infer,
  SchemaValidationError,
  type ZObject,
  type ZType,
  z,
} from "alepha";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { UsageError } from "../errors/UsageError.ts";
import { Asker } from "../helpers/Asker.ts";
import { EnvUtils } from "../helpers/EnvUtils.ts";
import { Runner } from "../helpers/Runner.ts";
import {
  $command,
  type CommandHandlerArgs,
  type CommandPrimitive,
} from "../primitives/$command.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = z.object({
  CLI_NAME: z.text({
    default: "cli",
    description: "Name of the CLI application.",
  }),
  CLI_DESCRIPTION: z.text({
    default: "",
    description: "Description of the CLI application.",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

/**
 * CLI provider configuration atom
 */
export const cliOptions = $atom({
  name: "alepha.command.cli.options",
  schema: z.object({
    name: z.string().describe("Name of the CLI application.").optional(),
    description: z
      .string()
      .describe("Description of the CLI application.")
      .optional(),
    argv: z
      .array(z.string())
      .describe("Command line arguments to parse.")
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

export type CliProviderOptions = Infer<typeof cliOptions.schema>;

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
 *     flags: z.object({ watch: z.boolean().optional() }),
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
  protected readonly options = $store(cliOptions);

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
      schema: z.boolean(),
    },
    verbose: {
      // No `-v` alias — it collides with `--version` on the root command.
      aliases: ["verbose"],
      description:
        "Verbose output: trace-level logs (framework internals) in pretty format, and task output streams live.",
      schema: z.boolean(),
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

      // Resolve command using space-separated or colon-notation, skipping
      // argv slots that are flag values rather than positionals.
      const { command, consumedArgs, positionalArgs } =
        this.resolveCommandFromArgv(argv);

      try {
        return await this.dispatch(argv, command, consumedArgs, positionalArgs);
      } catch (error) {
        // Nothing has run yet — the argv itself was rejected. Render it the way
        // an unknown command is rendered, not as a crash.
        if (error instanceof UsageError) {
          return this.reportUsage(error.message, command);
        }
        throw error;
      }
    },
  });

  /**
   * Resolve what the argv asks for and run it.
   *
   * Split out of the `ready` hook so the hook has one job: turn a
   * {@link UsageError} into a usage message. Every throw below is either a
   * `UsageError` (the user's argv is wrong) or a genuine failure that should
   * keep its stack.
   */
  protected async dispatch(
    argv: string[],
    command: CommandPrimitive<ZObject> | undefined,
    consumedArgs: string[],
    positionalArgs: string[],
  ): Promise<void> {
    const globalFlags = this.parseFlags(
      argv,
      Object.entries(this.getAllGlobalFlags()).map(([key, value]) => ({
        key,
        ...value,
      })),
      { strict: false }, // Don't throw for command-specific flags
    );

    // `--verbose` → raise the logger to trace + pretty format via state
    // (read live by Logger). At DEBUG level Runner also switches shelled
    // task output from captured to streamed, so tool output shows live.
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
        return this.reportUsage(`Unknown command: '${commandName}'`);
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
  }

  /**
   * Print a usage failure the way a CLI should: the reason, then the help for
   * whatever context we managed to resolve, then a non-zero exit code.
   *
   * A typo must not report success. Exit code rather than a throw: throwing
   * surfaces as "Alepha failed to start" plus a stack through `CliProvider`
   * internals, which reads as a crash when the right answer is a usage
   * message. The `process` guard mirrors core/index.ts — there is no process
   * in workerd or the browser.
   */
  protected reportUsage(
    message: string,
    command?: CommandPrimitive<ZObject>,
  ): void {
    this.log.error(message);
    this.printHelp(command);
    if (typeof process === "object") {
      process.exitCode = 1;
    }
  }

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
    command: CommandPrimitive<ZObject>,
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
        await hook.options.handler(args as CommandHandlerArgs<ZObject>);
      }

      // Execute main command
      await command.options.handler(args as CommandHandlerArgs<ZObject>);

      // Execute post-hooks
      const postHooks = this.findPostHooks(command.name);
      for (const hook of postHooks) {
        this.log.debug(`Executing post-hook for '${command.name}'...`);
        await hook.options.handler(args as CommandHandlerArgs<ZObject>);
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

    let afterTerminator = false;
    for (const arg of argv) {
      // `--` ends flag parsing: everything after it is a positional, even if
      // it starts with a dash.
      if (arg === "--") {
        afterTerminator = true;
        continue;
      }
      // A negative number is a VALUE, not a flag — `--count -5` used to fail
      // because any token starting with `-` was treated as a flag name.
      if (!afterTerminator && arg.startsWith("-") && !/^-\d/.test(arg)) {
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
  /**
   * Resolve a command from the raw argv, skipping argv slots that are flag
   * VALUES rather than positionals.
   *
   * `argv.filter(a => !a.startsWith("-"))` ran before any flag parsing, so
   * `cli deploy --target vercel` saw `vercel` as a positional and walked into
   * a `vercel` subcommand — after which `--target` failed as "requires a
   * value". Flags before the command (`cli --mode production build`) made
   * `production` the resolved command → "Unknown command".
   *
   * The flag definitions of EVERY registered command are used, not just the
   * global ones: which command owns `--target` is exactly what we are trying
   * to work out, so the superset is the only thing available this early. A
   * value-taking flag anywhere in the app therefore consumes its next
   * argument here — which is the behaviour a user expects from a CLI.
   */
  protected resolveCommandFromArgv(argv: string[]): {
    command: CommandPrimitive<ZObject> | undefined;
    consumedArgs: string[];
    positionalArgs: string[];
  } {
    const flagDefs = [
      ...Object.entries(this.getAllGlobalFlags()).map(([key, value]) => ({
        key,
        aliases: value.aliases,
        schema: value.schema,
      })),
      ...this.commands.flatMap((command) => {
        const flags = (command.options as { flags?: ZObject }).flags;
        return flags ? this.extractFlagDefs(flags) : [];
      }),
    ];

    const consumedIndices = this.getFlagConsumedIndices(argv, flagDefs);

    const positionalArgs = argv.filter(
      (arg, idx) => !arg.startsWith("-") && !consumedIndices.has(idx),
    );

    return { ...this.resolveCommand(positionalArgs), positionalArgs };
  }

  protected resolveCommand(positionalArgs: string[]): {
    command: CommandPrimitive<ZObject> | undefined;
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
  public async run<T extends ZObject, A extends ZType>(
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
  protected findCommand(name: string): CommandPrimitive<ZObject> | undefined {
    return this.commands.findLast(
      (command) => command.name === name || command.aliases.includes(name),
    );
  }

  /**
   * Find a top-level command by name or alias (excludes child commands)
   */
  protected findTopLevelCommand(
    name: string,
  ): CommandPrimitive<ZObject> | undefined {
    return this.getTopLevelCommands().findLast(
      (command) => command.name === name || command.aliases.includes(name),
    );
  }

  /**
   * Find all pre-hooks for a command (commands named `pre{commandName}`)
   */
  protected findPreHooks(commandName: string): CommandPrimitive<ZObject>[] {
    return this.commands.filter((cmd) => cmd.name === `pre${commandName}`);
  }

  /**
   * Find all post-hooks for a command (commands named `post{commandName}`)
   */
  protected findPostHooks(commandName: string): CommandPrimitive<ZObject>[] {
    return this.commands.filter((cmd) => cmd.name === `post${commandName}`);
  }

  /**
   * Get global flags (help only, root command flags are NOT global)
   */
  protected getAllGlobalFlags(): Record<
    string,
    { aliases: string[]; description?: string; schema: ZType }
  > {
    return { ...this.globalFlags };
  }

  /**
   * Read a schema's metadata (`title`, `description`, `aliases`, `alias`, …).
   *
   * Under zod these options live on the schema's `.meta()` registry rather than
   * as direct properties (typebox), and they sit on the INNER schema — so any
   * optional / nullable / default wrappers are peeled first.
   */
  protected schemaMeta(schema: ZType | undefined): Record<string, any> {
    if (!schema) return {};
    const base = z.schema.unwrap(schema) as any;
    return (typeof base?.meta === "function" ? base.meta() : undefined) ?? {};
  }

  /**
   * Build flag definitions (key, aliases, description, schema) from a flags
   * object schema. Centralises the metadata reading so every call-site (parsing,
   * arg-splitting, help) extracts aliases/descriptions the same way.
   */
  protected extractFlagDefs(schema: ZObject): Array<{
    key: string;
    aliases: string[];
    description?: string;
    schema: ZType;
  }> {
    return Object.entries(z.schema.shape(schema)).map(([key, value]) => {
      const meta = this.schemaMeta(value as ZType);
      const extra: string[] = meta.aliases ?? (meta.alias ? [meta.alias] : []);
      return {
        key,
        aliases: [key, ...extra],
        description: meta.description,
        schema: value as ZType,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Parsing (Flags, Args, Env)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parse command flags from argv using the command's flag schema
   */
  protected parseCommandFlags(
    argv: string[],
    schema: ZObject,
    options: { modeEnabled?: boolean } = {},
  ): Record<string, any> {
    const { modeEnabled = false } = options;
    const flagDefs = this.extractFlagDefs(schema);

    // Add mode flags if mode is enabled (they're parsed elsewhere by parseModeFlag)
    if (modeEnabled) {
      flagDefs.push({
        key: "__mode__",
        aliases: ["mode", "m"],
        description: undefined,
        schema: z.string(),
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
    for (const [key, value] of Object.entries(z.schema.shape(schema))) {
      if (!(key in parsed)) {
        const def = z.schema.getDefault(value);
        if (def !== undefined) {
          parsed[key] = def;
        }
      }
    }

    try {
      return this.alepha.codec.decode(schema, parsed);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new UsageError(
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
    schema: ZObject,
    commandName: string,
  ): Record<string, any> {
    const result: Record<string, any> = {};
    const missing: string[] = [];

    for (const [key, propSchema] of Object.entries(z.schema.shape(schema))) {
      const value = process.env[key];

      if (value !== undefined) {
        result[key] = value;
      } else {
        const def = z.schema.getDefault(propSchema);
        if (def !== undefined) {
          result[key] = def;
        } else if (z.schema.isOptional(propSchema)) {
          // Optional with no default — leave undefined
        } else {
          missing.push(key);
        }
      }
    }

    if (missing.length > 0) {
      const vars = missing.join(", ");
      throw new UsageError(
        `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${vars}`,
      );
    }

    try {
      return this.alepha.codec.decode(schema, result);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new UsageError(
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
        throw new UsageError("Flag --mode requires a value.");
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
    flagDefs: { key: string; aliases: string[]; schema: ZType }[],
    options: { strict?: boolean } = {},
  ): Record<string, any> {
    const { strict = true } = options;
    const result: Record<string, any> = {};

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (!arg.startsWith("-")) continue;

      const [rawKey, ...valueParts] = arg.replace(/^-{1,2}/, "").split("=");
      const value = valueParts.join("=");

      const def = flagDefs.find((d) => d.aliases.includes(rawKey));
      if (!def) {
        if (strict) {
          throw new UsageError(`Unknown flag: --${rawKey}`);
        }
        continue;
      }

      // Resolve the underlying schema (peel optional/nullable/default) so flags
      // like `z.boolean().optional()` are still recognised as booleans.
      const base = z.schema.unwrap(def.schema);

      // Check if schema is a union containing boolean (allows flag without value)
      const isUnionWithBoolean =
        z.schema.isUnion(base) &&
        z.schema.options(base).some((s) => z.schema.isBoolean(s));

      if (z.schema.isBoolean(base)) {
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
        result[def.key] = this.castFlagValue(value, base, rawKey);
      } else {
        // Check for space-separated value: --flag value
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          result[def.key] = this.castFlagValue(nextArg, base, rawKey);
        } else {
          throw new UsageError(`Flag --${rawKey} requires a value.`);
        }
      }
    }

    return result;
  }

  /**
   * Convert a raw flag value string into the value its schema expects.
   *
   * zod no longer coerces, so scalar values (number / integer / boolean) are
   * cast + validated via {@link parseArgumentValue} (same path as positional
   * args); object / array / record values are JSON-parsed. `schema` is expected
   * to already be unwrapped of optional/nullable/default.
   */
  protected castFlagValue(value: string, schema: ZType, rawKey: string): any {
    if (
      z.schema.isObject(schema) ||
      z.schema.isArray(schema) ||
      z.schema.isRecord(schema)
    ) {
      try {
        return JSON.parse(value);
      } catch {
        throw new UsageError(`Invalid JSON value for flag --${rawKey}`);
      }
    }
    return this.parseArgumentValue(value, schema);
  }

  /**
   * Get indices of argv elements consumed by flags (for separating args from flags)
   */
  protected getFlagConsumedIndices(
    argv: string[],
    flagDefs: { key: string; aliases: string[]; schema: ZType }[],
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

      // Peel optional/nullable/default so boolean flags are recognised.
      const base = z.schema.unwrap(def.schema);

      // Check if schema is a union containing boolean
      const isUnionWithBoolean =
        z.schema.isUnion(base) &&
        z.schema.options(base).some((s) => z.schema.isBoolean(s));

      // If not a boolean flag and no = value, the next arg is consumed as the value
      // Exception: union with boolean can work without a value
      if (!z.schema.isBoolean(base) && !isUnionWithBoolean && !hasEqualValue) {
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
    schema?: ZType,
    isRootCommand = false,
    flagSchema?: ZObject,
  ): any {
    if (!schema) {
      return undefined;
    }

    // Get indices consumed by flags (including space-separated values)
    const flagDefs = flagSchema ? this.extractFlagDefs(flagSchema) : [];
    const consumedIndices = this.getFlagConsumedIndices(argv, flagDefs);

    // Extract positional arguments (non-flag arguments that aren't consumed as flag values)
    const positionalArgs = argv.filter(
      (arg, idx) => !arg.startsWith("-") && !consumedIndices.has(idx),
    );
    // For root commands, there's no command name to remove; otherwise slice off the command name
    const argsOnly = isRootCommand ? positionalArgs : positionalArgs.slice(1);

    try {
      if (z.schema.isOptional(schema)) {
        // Handle optional args: z.text().optional()
        if (argsOnly.length === 0) {
          return undefined;
        }
        return this.parseArgumentValue(argsOnly[0], schema);
      } else if (z.schema.items(schema).length > 0) {
        // Handle tuple args: z.tuple([z.text(), z.number()])
        const result: any[] = [];
        const items = z.schema.items(schema);
        for (let i = 0; i < items.length; i++) {
          const itemSchema = items[i];
          if (i < argsOnly.length) {
            result.push(this.parseArgumentValue(argsOnly[i], itemSchema));
          } else if (z.schema.isOptional(itemSchema)) {
            result.push(undefined);
          } else {
            throw new UsageError(
              `Missing required argument at position ${i + 1}`,
            );
          }
        }
        return result;
      } else {
        // Handle single arg: z.text(), z.number(), etc.
        if (argsOnly.length === 0) {
          throw new UsageError("Missing required argument");
        }
        return this.parseArgumentValue(argsOnly[0], schema);
      }
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new UsageError(`Invalid argument: ${error.value.message}`);
      }
      throw error;
    }
  }

  /**
   * Convert a string argument value to the appropriate type based on schema
   */
  protected parseArgumentValue(value: string, schema: ZType): any {
    if (z.schema.isString(schema)) {
      return value;
    }

    if (z.schema.isNumber(schema) || z.schema.isInteger(schema)) {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new UsageError(`Expected number, got "${value}"`);
      }
      if (z.schema.isInteger(schema) && !Number.isInteger(num)) {
        throw new UsageError(`Expected integer, got "${value}"`);
      }
      return num;
    }

    if (z.schema.isBoolean(schema)) {
      const lower = value.toLowerCase();
      if (lower === "true" || lower === "1") return true;
      if (lower === "false" || lower === "0") return false;
      throw new UsageError(`Expected boolean, got "${value}"`);
    }

    // For other types, return the string value and let Zod validate it
    return value;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Help Generation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate usage string for command arguments (e.g., "<path>" or "[path]")
   */
  protected generateArgsUsage(schema?: ZType): string {
    if (!schema) {
      return "";
    }

    if (z.schema.isOptional(schema)) {
      const typeName = this.getTypeName(schema);
      const key = this.schemaMeta(schema).title ?? "arg1";
      return ` [${key}${typeName}]`;
    }

    if (z.schema.items(schema).length > 0) {
      const items = z.schema.items(schema);
      const args = items.map((item, index) => {
        const argName = `arg${index + 1}`;
        const typeName = this.getTypeName(item);
        if (z.schema.isOptional(item)) {
          return `[${argName}${typeName}]`;
        }
        return `<${argName}${typeName}>`;
      });
      return ` ${args.join(" ")}`;
    }

    const typeName = this.getTypeName(schema);
    const key = this.schemaMeta(schema).title ?? "arg1";
    return ` <${key}${typeName}>`;
  }

  /**
   * Get display type name for a schema (e.g., ": number", ": boolean")
   */
  protected getTypeName(schema: ZType): string {
    if (!schema) return "";

    // Peel optional/nullable/default before inspecting the scalar type.
    const base = z.schema.unwrap(schema);

    // Order matters: under zod an integer IS a number (format "safeint"), so the
    // narrower integer check must come before the number check.
    if (z.schema.isString(base)) return "";
    if (z.schema.isInteger(base)) return ": integer";
    if (z.schema.isNumber(base)) return ": number";
    if (z.schema.isBoolean(base)) return ": boolean";

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
    // Restore afterwards: `help()` is handed to command handlers (a parent
    // command prints help and then continues), so flipping the format
    // permanently made every later log lose its timestamp and level.
    const previousFormat = this.alepha.store.get("alepha.logger.format");
    this.alepha.store.set("alepha.logger.format", "raw");
    const restoreFormat = () =>
      this.alepha.store.set("alepha.logger.format", previousFormat);

    try {
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
          // Read aliases/description from the schema's `.meta()` registry (zod),
          // not as direct schema properties (typebox) — see extractFlagDefs.
          ...this.extractFlagDefs(command.flags),
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
                  schema: z.string() as ZType,
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
          const schema = "schema" in flag ? (flag.schema as ZType) : undefined;
          // Sort aliases by length (shorter first: -t before --target)
          const sortedAliases = (Array.isArray(aliases) ? aliases : [aliases])
            .slice()
            .sort((a, b) => a.length - b.length);
          const flagStr = sortedAliases
            .map((a: string) => (a.length === 1 ? `-${a}` : `--${a}`))
            .join(", ");
          const coloredFlag = c.set("GREY_LIGHT", flagStr);
          const padding = " ".repeat(
            Math.max(0, maxFlagLength - flagStr.length),
          );
          const formattedDesc = this.formatFlagDescription(description, schema);
          this.log.info(`    ${coloredFlag}${padding}  ${formattedDesc}`);
        }

        // Show environment variables if defined
        const envVars = Object.entries(z.schema.shape(command.env));
        if (envVars.length > 0) {
          this.log.info("");
          this.log.info(c.set("WHITE_BOLD", "Env:"));
          const maxEnvLength = Math.max(...envVars.map(([key]) => key.length));
          for (const [key, schema] of envVars) {
            const isOptional = z.schema.isOptional(schema as ZType);
            // Wrapped schemas (`.optional()`) keep the description in the
            // INNER schema's `.meta()` registry, so reading `.description`
            // off the wrapper rendered an empty Env: section.
            const description =
              this.schemaMeta(schema as ZType).description ?? "";
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
        // Read aliases/description from the schema's `.meta()` registry (zod),
        // not as direct schema properties (typebox) — see extractFlagDefs.
        const rootFlags = rootCommand
          ? this.extractFlagDefs(rootCommand.flags)
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
          const padding = " ".repeat(
            Math.max(0, maxFlagLength - flagStr.length),
          );
          const formattedDesc = this.formatFlagDescription(description, schema);
          this.log.info(`    ${coloredFlag}${padding}  ${formattedDesc}`);
        }
      }
      this.log.info(""); // Newline
    } finally {
      restoreFormat();
    }
  }

  /**
   * Generate colored usage string for command arguments (for help display)
   */
  protected generateColoredArgsUsage(schema?: ZType): string {
    if (!schema) {
      return "";
    }

    const c = this.color;

    if (z.schema.isOptional(schema)) {
      const typeName = this.getTypeName(schema);
      const key = this.schemaMeta(schema).title ?? "arg1";
      return ` ${c.set("GREY_DARK", `[${key}${typeName}]`)}`;
    }

    if (z.schema.items(schema).length > 0) {
      const items = z.schema.items(schema);
      const args = items.map((item, index) => {
        const argName = `arg${index + 1}`;
        const typeName = this.getTypeName(item);
        if (z.schema.isOptional(item)) {
          return c.set("GREY_DARK", `[${argName}${typeName}]`);
        }
        return c.set("CYAN", `<${argName}${typeName}>`);
      });
      return ` ${args.join(" ")}`;
    }

    const typeName = this.getTypeName(schema);
    const key = this.schemaMeta(schema).title ?? "arg1";
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
   * Get top-level commands (commands that are not children of other commands).
   *
   * Deduplicated by name, keeping the LAST registration. A project that
   * redefines a builtin in its `alepha.config.ts` — `clean` and `verify` in
   * this repo — otherwise appeared twice in `--help`, with two contradictory
   * descriptions, while only one of them could ever run. Last-wins is not a
   * choice made here: it is what {@link findCommand} already does with
   * `findLast`, so this makes the help agree with the resolution instead of
   * inventing a second rule.
   */
  protected getTopLevelCommands(): CommandPrimitive<any>[] {
    const allChildren = new Set<CommandPrimitive<any>>();

    // Collect all children
    for (const command of this.commands) {
      for (const child of command.children) {
        allChildren.add(child);
      }
    }

    const topLevel = this.commands.filter((cmd) => !allChildren.has(cmd));

    // Keep insertion order, but let a later same-named command take the
    // earlier one's slot rather than adding a row.
    const byName = new Map<string, CommandPrimitive<any>>();
    for (const cmd of topLevel) {
      byName.set(cmd.name, cmd);
    }
    return [...byName.values()];
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
  protected getEnumValues(schema: ZType): string[] | undefined {
    if (!schema) return undefined;

    const base = z.schema.unwrap(schema);

    // A zod enum (`z.enum`).
    if (z.schema.isEnum(base)) {
      const values = z.schema.enumValues(base);
      return values.length > 0 && values.every((v) => typeof v === "string")
        ? values
        : undefined;
    }

    // A union of string literals (alternative enum representation).
    if (z.schema.isUnion(base)) {
      const variants = z.schema.options(base);
      const values: string[] = [];

      for (const variant of variants) {
        const value = (variant as any).value; // zod literal value
        if (z.schema.isLiteral(variant) && typeof value === "string") {
          values.push(value);
        } else {
          // Not all variants are string literals, not a simple enum.
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
    schema: ZType | undefined,
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
