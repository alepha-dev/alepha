import type * as fs from "node:fs/promises";
import type { glob } from "node:fs/promises";
import {
  type Async,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZObject,
  type ZType,
  z,
} from "alepha";
import type { AskMethods } from "../helpers/Asker.ts";
import type { RunnerMethod } from "../helpers/Runner.ts";

/**
 * Declares a CLI command.
 *
 * This primitive allows you to define a command, its flags, and its handler
 * within your Alepha application structure.
 */
export const $command = <T extends ZObject, A extends ZType, E extends ZObject>(
  options: CommandPrimitiveOptions<T, A, E>,
) => createPrimitive(CommandPrimitive<T, A, E>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface CommandPrimitiveOptions<
  T extends ZObject,
  A extends ZType,
  E extends ZObject = ZObject,
> {
  /**
   * The handler function to execute when the command is matched.
   *
   * For parent commands with children, the handler is called when:
   * - The parent command is invoked without a subcommand
   * - The parent command is invoked with --help (to show available subcommands)
   */
  handler: (args: CommandHandlerArgs<T, A, E>) => Async<void>;

  /**
   * The name of the command. If omitted, the property key is used.
   *
   * An empty string "" denotes the root command.
   */
  name?: string;

  /**
   * A short description of the command, shown in the help message.
   */
  description?: string;

  /**
   * An array of alternative names for the command.
   */
  aliases?: string[];

  /**
   * A Zod object schema defining the flags for the command.
   */
  flags?: T;

  /**
   * A Zod object schema defining required environment variables.
   *
   * Environment variables are validated before the handler runs (fail fast).
   * They are displayed in the help output under "Env:" section.
   *
   * @example
   * ```ts
   * $command({
   *   env: z.object({
   *     VERCEL_TOKEN: z.text({ description: "Vercel API token" }),
   *     VERCEL_ORG_ID: z.text({ description: "Organization ID" }).optional(),
   *   }),
   *   handler: async ({ env }) => {
   *     // env.VERCEL_TOKEN is typed & guaranteed to exist
   *     console.log(env.VERCEL_TOKEN);
   *   }
   * })
   * ```
   */
  env?: E;

  /**
   * An optional Zod schema defining the arguments for the command.
   *
   * @example
   * args: z.text()
   * my-cli command <arg1: string>
   *
   * args: z.text().optional()
   * my-cli command [arg1: string]
   *
   * args: z.tuple([z.text(), z.number()])
   * my-cli command <arg1: string> <arg2: number>
   *
   * args: z.tuple([z.text(), z.number().optional()])
   * my-cli command <arg1: string> [arg2: number]
   */
  args?: A;

  /**
   * Marks this command as the root command.
   * Equivalent to setting name to an empty string "".
   */
  root?: boolean;

  /**
   * Run this command's handler BEFORE the specified target command.
   *
   * Pre-hooks are not listed in help and cannot be called directly.
   * They receive the same parsed flags and args as the target command.
   *
   * @example
   * ```ts
   * class BuildCommands {
   *   prebuild = $command({
   *     pre: "build",
   *     handler: async ({ run }) => {
   *       await run("cleaning dist folder...", () => fs.rm("dist"));
   *     }
   *   });
   *
   *   build = $command({
   *     name: "build",
   *     handler: async () => { ... }
   *   });
   * }
   * ```
   */
  pre?: string;

  /**
   * Run this command's handler AFTER the specified target command.
   *
   * Post-hooks are not listed in help and cannot be called directly.
   * They receive the same parsed flags and args as the target command.
   *
   * @example
   * ```ts
   * class BuildCommands {
   *   build = $command({
   *     name: "build",
   *     handler: async () => { ... }
   *   });
   *
   *   postbuild = $command({
   *     post: "build",
   *     handler: async ({ run }) => {
   *       await run("generating checksums...", generateChecksums);
   *     }
   *   });
   * }
   * ```
   */
  post?: string;

  /**
   * If true, this command will be hidden from the help output.
   */
  hide?: boolean;

  /**
   * Adds a `--mode, -m` flag to load environment files.
   *
   * When enabled:
   * - Loads `.env` and `.env.local` by default
   * - With `--mode production`, also loads `.env.production` and `.env.production.local`
   * - The mode value is exposed in the handler as `mode: string | undefined`
   *
   * Set to `true` to enable with no default, or a string to set a default mode.
   *
   * This follows Vite's environment loading convention.
   * @see https://vite.dev/guide/env-and-mode
   *
   * @example
   * ```ts
   * // No default mode
   * build = $command({
   *   mode: true,
   *   handler: async ({ mode }) => {
   *     console.log(`Building for ${mode ?? 'development'}...`);
   *   }
   * });
   *
   * // Default mode "production"
   * deploy = $command({
   *   mode: "production",
   *   handler: async ({ mode }) => {
   *     console.log(`Deploying for ${mode}...`); // always defined
   *   }
   * });
   * ```
   *
   * Usage:
   * - `cli build` - loads .env (mode = undefined)
   * - `cli build --mode production` - loads .env and .env.production
   * - `cli deploy` - loads .env and .env.production (default mode)
   * - `cli deploy --mode staging` - loads .env and .env.staging
   */
  mode?: boolean | string;

  /**
   * Child commands (subcommands) for this command.
   *
   * When children are defined, the command becomes a parent command that
   * can be invoked with space-separated subcommands:
   *
   * @example
   * ```ts
   * class DeployCommands {
   *   // Subcommands
   *   vercel = $command({
   *     description: "Deploy to Vercel",
   *     handler: async () => { ... }
   *   });
   *
   *   cloudflare = $command({
   *     description: "Deploy to Cloudflare",
   *     handler: async () => { ... }
   *   });
   *
   *   // Parent command with children
   *   deploy = $command({
   *     description: "Deploy the application",
   *     children: [this.vercel, this.cloudflare],
   *     handler: async () => {
   *       // Called when "deploy" is invoked without subcommand
   *       console.log("Available: deploy vercel, deploy cloudflare");
   *     }
   *   });
   * }
   * ```
   *
   * This allows CLI usage like:
   * - `cli deploy vercel` - runs the vercel subcommand
   * - `cli deploy cloudflare` - runs the cloudflare subcommand
   * - `cli deploy` - runs the parent handler (shows available subcommands)
   * - `cli deploy --help` - shows help with all available subcommands
   */
  children?: CommandPrimitive<any, any>[];
}

// ---------------------------------------------------------------------------------------------------------------------

export class CommandPrimitive<
  T extends ZObject = ZObject,
  A extends ZType = ZType,
  E extends ZObject = ZObject,
> extends Primitive<CommandPrimitiveOptions<T, A, E>> {
  public readonly flags = this.options.flags ?? z.object({});
  public readonly env = this.options.env ?? z.object({});
  public readonly aliases = this.options.aliases ?? [];

  protected onInit() {
    if (this.options.pre || this.options.post) {
      this.options.hide ??= true;
    }
  }

  public get name(): string {
    if (this.options.root) {
      return "";
    }
    if (this.options.pre) {
      return `pre${this.options.pre}`;
    }
    if (this.options.post) {
      return `post${this.options.post}`;
    }
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * Get the child commands (subcommands) for this command.
   */
  public get children(): CommandPrimitive<any, any>[] {
    return this.options.children ?? [];
  }

  /**
   * Check if this command has child commands (is a parent command).
   */
  public get hasChildren(): boolean {
    return this.children.length > 0;
  }

  /**
   * Find a child command by name or alias.
   */
  public findChild(name: string): CommandPrimitive<any, any> | undefined {
    return this.children.find(
      (child) => child.name === name || child.aliases.includes(name),
    );
  }
}

$command[KIND] = CommandPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface CommandHandlerArgs<
  T extends ZObject,
  A extends ZType = ZType,
  E extends ZObject = ZObject,
> {
  flags: Infer<T>;
  args: A extends ZType ? Infer<A> : Array<string>;
  env: Infer<E>;
  run: RunnerMethod;
  ask: AskMethods;
  glob: typeof glob;
  fs: typeof fs;

  /**
   * The root directory where the command is executed.
   */
  root: string;

  /**
   * Display help for the current command.
   *
   * Useful for parent commands with children to show available subcommands
   * when invoked without a specific subcommand.
   *
   * @example
   * ```ts
   * deploy = $command({
   *   children: [this.vercel, this.cloudflare],
   *   handler: async ({ help }) => {
   *     help(); // Shows available subcommands
   *   }
   * });
   * ```
   */
  help: () => void;

  /**
   * Write a line of output to stdout.
   *
   * Output is what the command *produces*; the logger is for what it
   * *reports*. Anything a caller might pipe, parse or redirect belongs here —
   * a version string, a rendered table, a generated config — while progress
   * and diagnostics stay with `$logger`.
   *
   * Going through the logger instead is what made `alepha --version` return
   * `18:21:36 I Alepha v0.24.0` with colour codes: a timestamped log line
   * whose very shape changed with `LOG_FORMAT`, an environment variable the
   * calling script does not control.
   *
   * Colour is stripped automatically when stdout is not a TTY, so a coloured
   * string here is still safe to pipe.
   *
   * @example
   * ```ts
   * version = $command({
   *   handler: async ({ print }) => {
   *     print("0.24.0"); // `cli --version | cat` yields exactly "0.24.0"
   *   }
   * });
   * ```
   */
  print: (message?: string) => void;

  /**
   * The current execution mode (e.g., "development", "production", "staging").
   *
   * Use --mode flag to set this value when running the command.
   */
  mode?: string;
}
