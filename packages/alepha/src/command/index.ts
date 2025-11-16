import { $module } from "alepha";
import { $command } from "./descriptors/$command.ts";
import { Asker } from "./helpers/Asker.ts";
import { PrettyPrint } from "./helpers/PrettyPrint.ts";
import { Runner } from "./helpers/Runner.ts";
import { CliProvider } from "./providers/CliProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$command.ts";
export * from "./errors/CommandError.ts";
export * from "./helpers/Asker.ts";
export * from "./helpers/PrettyPrint.ts";
export * from "./helpers/Runner.ts";
export * from "./providers/CliProvider.ts";

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
  services: [CliProvider, Runner, Asker, PrettyPrint],
});

// ---------------------------------------------------------------------------------------------------------------------

declare module "typebox" {
  interface StringOptions {
    /**
     * Additional aliases for the flags.
     *
     * @module alepha.command
     */
    aliases?: string[];
  }
}
