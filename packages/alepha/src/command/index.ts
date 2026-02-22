import { $module } from "alepha";
import { Asker } from "./helpers/Asker.ts";
import { EnvUtils } from "./helpers/EnvUtils.ts";
import { PrettyPrint } from "./helpers/PrettyPrint.ts";
import { Runner } from "./helpers/Runner.ts";
import { $command } from "./primitives/$command.ts";
import { CliProvider } from "./providers/CliProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/CommandError.ts";
export * from "./helpers/Asker.ts";
export * from "./helpers/EnvUtils.ts";
export * from "./helpers/PrettyPrint.ts";
export * from "./helpers/Runner.ts";
export * from "./primitives/$command.ts";
export * from "./providers/CliProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Declarative CLI command framework.
 *
 * **Features:**
 * - CLI command definitions
 * - Interactive CLI prompts
 * - Command execution
 * - Formatted colored output
 * - Environment variable utilities
 * - Schema validation for CLI arguments
 *
 * @module alepha.command
 */
export const AlephaCommand = $module({
  name: "alepha.command",
  primitives: [$command],
  services: [CliProvider, Runner, Asker, PrettyPrint, EnvUtils],
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
