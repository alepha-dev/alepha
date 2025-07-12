import { __bind, type Alepha, type Module } from "@alepha/core";
import { $command } from "./descriptors/$command.ts";
import { CommandDescriptorProvider } from "./providers/CommandDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$command.ts";
export * from "./errors/CommandError.ts";
export * from "./helpers/Runner.ts";
export * from "./providers/CommandDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Command Module
 *
 * This module provides a powerful way to build command-line interfaces
 * directly within your Alepha application, using declarative descriptors.
 *
 * @see {@link $command}
 * @module alepha.command
 */
export class AlephaCommand implements Module {
	public readonly name = "alepha.command";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha.with(CommandDescriptorProvider);
}

__bind($command, AlephaCommand);
