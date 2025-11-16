import type * as fs from "node:fs/promises";
import type { glob } from "node:fs/promises";
import {
  type Async,
  createDescriptor,
  Descriptor,
  KIND,
  type Static,
  type TObject,
  type TSchema,
  t,
} from "alepha";
import type { AskMethod } from "../helpers/Asker.ts";
import type { RunnerMethod } from "../helpers/Runner.ts";

/**
 * Declares a CLI command.
 *
 * This descriptor allows you to define a command, its flags, and its handler
 * within your Alepha application structure.
 */
export const $command = <T extends TObject, A extends TSchema>(
  options: CommandDescriptorOptions<T, A>,
) => createDescriptor(CommandDescriptor<T, A>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface CommandDescriptorOptions<
  T extends TObject,
  A extends TSchema,
> {
  /**
   * The handler function to execute when the command is matched.
   */
  handler: (args: CommandHandlerArgs<T, A>) => Async<void>;

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
   * A TypeBox object schema defining the flags for the command.
   */
  flags?: T;

  /**
   * An optional TypeBox schema defining the arguments for the command.
   *
   * @example
   * args: t.text()
   * my-cli command <arg1: string>
   *
   * args: t.optional(t.text())
   * my-cli command [arg1: string]
   *
   * args: t.tuple([t.text(), t.number()])
   * my-cli command <arg1: string> <arg2: number>
   *
   * args: t.tuple([t.text(), t.optional(t.number())])
   * my-cli command <arg1: string> [arg2: number]
   */
  args?: A;

  /**
   * If false, skip summary message at the end of the command execution.
   * Summary will display only if ({ run }) method calls were made.
   */
  summary?: boolean;

  /**
   * Marks this command as the root command.
   * Equivalent to setting name to an empty string "".
   */
  root?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class CommandDescriptor<
  T extends TObject = TObject,
  A extends TSchema = TSchema,
> extends Descriptor<CommandDescriptorOptions<T, A>> {
  public readonly flags = this.options.flags ?? t.object({});
  public readonly aliases = this.options.aliases ?? [];

  public get name(): string {
    if (this.options.root) {
      return "";
    }
    return this.options.name ?? `${this.config.propertyKey}`;
  }
}

$command[KIND] = CommandDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface CommandHandlerArgs<
  T extends TObject,
  A extends TSchema = TSchema,
> {
  flags: Static<T>;
  args: A extends TSchema ? Static<A> : Array<string>;
  run: RunnerMethod;
  ask: AskMethod;
  glob: typeof glob;
  fs: typeof fs;

  /**
   * The root directory where the command is executed.
   */
  root: string;
}
