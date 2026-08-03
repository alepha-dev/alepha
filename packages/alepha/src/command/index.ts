import { $module } from "alepha";
import { Asker } from "./helpers/Asker.ts";
import { EnvUtils } from "./helpers/EnvUtils.ts";
import { Runner } from "./helpers/Runner.ts";
import { $command } from "./primitives/$command.ts";
import { CliProvider } from "./providers/CliProvider.ts";
import { ConsoleOutputProvider } from "./providers/ConsoleOutputProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/CommandError.ts";
export * from "./errors/NoInputError.ts";
export * from "./errors/UsageError.ts";
export * from "./helpers/Asker.ts";
export * from "./helpers/EnvUtils.ts";
export * from "./helpers/Runner.ts";
export * from "./primitives/$command.ts";
export * from "./providers/CliProvider.ts";
export * from "./providers/ConsoleOutputProvider.ts";
export * from "./providers/MemoryOutputProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Declarative CLI command framework.
 *
 * **Features:**
 * - CLI command definitions
 * - Interactive CLI prompts (plain readline)
 * - Command execution with captured output (streamed live at DEBUG level)
 * - Environment variable utilities
 * - Schema validation for CLI arguments
 *
 * @module alepha.command
 */
export const AlephaCommand = $module({
  name: "alepha.command",
  primitives: [$command],
  services: [CliProvider, ConsoleOutputProvider, Runner, Asker, EnvUtils],
});

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface StringOptions {
    /**
     * Additional aliases for the flags.
     *
     * @module alepha.command
     */
    aliases?: string[];
  }
}
