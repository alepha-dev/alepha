import { $module } from "alepha";
import { Asker } from "./helpers/Asker.ts";
import { EnvUtils } from "./helpers/EnvUtils.ts";
import { PrettyPrint } from "./helpers/PrettyPrint.ts";
import { Runner } from "./helpers/Runner.ts";
import { $command } from "./primitives/$command.ts";
import { CliProvider } from "./providers/CliProvider.ts";
import { MemoryShellProvider } from "./providers/MemoryShellProvider.ts";
import { NodeShellProvider } from "./providers/NodeShellProvider.ts";
import { ShellProvider } from "./providers/ShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/CommandError.ts";
export * from "./helpers/Asker.ts";
export * from "./helpers/EnvUtils.ts";
export * from "./helpers/PrettyPrint.ts";
export * from "./helpers/Runner.ts";
export * from "./primitives/$command.ts";
export * from "./providers/CliProvider.ts";
export * from "./providers/MemoryShellProvider.ts";
export * from "./providers/NodeShellProvider.ts";
export * from "./providers/ShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | tooling | rare | stable |
 *
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
  services: [
    CliProvider,
    Runner,
    Asker,
    PrettyPrint,
    EnvUtils,
    NodeShellProvider,
    ShellProvider,
    MemoryShellProvider,
  ],
  register: (alepha) => {
    alepha
      .with({
        optional: true,
        provide: ShellProvider,
        use: alepha.isTest() ? MemoryShellProvider : NodeShellProvider,
      })
      .with(CliProvider)
      .with(PrettyPrint)
      .with(EnvUtils);
  },
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
