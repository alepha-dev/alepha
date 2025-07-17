import { $module, type ModuleDescriptor } from "@alepha/core";
import { $command } from "./descriptors/$command.ts";
import { CommandDescriptorProvider } from "./providers/CommandDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$command.ts";
export * from "./errors/CommandError.ts";
export * from "./helpers/Runner.ts";
export * from "./providers/CommandDescriptorProvider.ts";

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
const AlephaCommand: ModuleDescriptor = $module({
	name: "alepha.command",
	descriptors: [$command],
	services: [CommandDescriptorProvider],
});

export default AlephaCommand;
