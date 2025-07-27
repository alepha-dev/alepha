import { $module } from "@alepha/core";
import { $command } from "./descriptors/$command.ts";
import { CliProvider } from "./providers/CliProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$command.ts";
export * from "./errors/CommandError.ts";
export * from "./helpers/Runner.ts";
export * from "./providers/CliProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@sinclair/typebox" {
	interface StringOptions {
		/**
		 * Additional aliases for the flags.
		 *
		 * @module alepha.command
		 */
		aliases?: string[];
	}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * This module provides a powerful way to build command-line interfaces
 * directly within your Alepha application, using declarative descriptors.
 *
 * It allows you to define commands using the `$command` descriptor.
 *
 * @see {@link $command}
 * @module alepha.command
 */
export const AlephaCommand = $module({
	name: "alepha.command",
	descriptors: [$command],
	services: [CliProvider],
});
