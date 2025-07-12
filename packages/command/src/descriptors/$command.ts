import {
	__descriptor,
	type Async,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
	type TObject,
} from "@alepha/core";
import type { Options, ProcessPromise, Shell } from "zx/core";
import type { fn, RunnerMethod, sh } from "../helpers/Runner.ts";

const KEY = "COMMAND";

export type Zx = Shell & Options;

export type RunArgs =
	| ProcessPromise
	| {
			name: string;
			task: ProcessPromise | (() => any);
	  };

export interface CommandDescriptorOptions<T extends TObject> {
	/**
	 * The handler function to execute when the command is matched.
	 */
	handler: (args: {
		flags: Static<T>;
		sh: typeof sh;
		fn: typeof fn;
		run: RunnerMethod;
	}) => Async<void>;

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
}

export interface CommandDescriptor<T extends TObject> {
	[KIND]: typeof KEY;
	[OPTIONS]: CommandDescriptorOptions<T>;

	/**
	 * Executes the command. This is a placeholder and will be replaced by the provider.
	 */
	(flags: Static<T>): Promise<void>;
}

/**
 * Declares a CLI command.
 *
 * This descriptor allows you to define a command, its flags, and its handler
 * within your Alepha application structure.
 */
export const $command: {
	<T extends TObject>(
		options: CommandDescriptorOptions<T>,
	): CommandDescriptor<T>;
	[KIND]: string;
} = <T extends TObject>(
	options: CommandDescriptorOptions<T>,
): CommandDescriptor<T> => {
	__descriptor(KEY);

	const $: Partial<CommandDescriptor<T>> = async () => {
		throw new NotImplementedError(KEY);
	};

	$[KIND] = KEY;
	$[OPTIONS] = options;

	return $ as CommandDescriptor<T>;
};

$command[KIND] = KEY;
