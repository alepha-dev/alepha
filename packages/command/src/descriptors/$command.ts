import type * as fs from "node:fs/promises";
import type { glob } from "node:fs/promises";
import {
	type Async,
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	type TObject,
	t,
} from "@alepha/core";
import type { RunnerMethod } from "../helpers/Runner.ts";

/**
 * Declares a CLI command.
 *
 * This descriptor allows you to define a command, its flags, and its handler
 * within your Alepha application structure.
 */
export const $command = <T extends TObject>(
	options: CommandDescriptorOptions<T>,
) => createDescriptor(CommandDescriptor<T>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface CommandDescriptorOptions<T extends TObject> {
	/**
	 * The handler function to execute when the command is matched.
	 */
	handler: (args: CommandHandlerArgs<T>) => Async<void>;

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
	 * If false, skip summary message at the end of the command execution.
	 */
	summary?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class CommandDescriptor<T extends TObject = TObject> extends Descriptor<
	CommandDescriptorOptions<T>
> {
	public readonly flags = this.options.flags ?? t.object({});
	public readonly aliases = this.options.aliases ?? [];

	public get name(): string {
		return this.options.name ?? `${this.config.propertyKey}`;
	}
}

$command[KIND] = CommandDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface CommandHandlerArgs<T extends TObject> {
	flags: Static<T>;
	run: RunnerMethod;
	glob: typeof glob;
	fs: typeof fs;
}
