import { $module } from "alepha";
import { AlephaInfraLibPlugin } from "alepha/cli/infra-lib";

import { InfraCommand } from "./commands/infra.ts";
import { SecretsCommand } from "./commands/SecretsCommand.ts";

/**
 * The single Node command surface, shared by the CLI and infra configuration.
 */
export const AlephaCliInfraCommands = $module({
  name: "alepha.cli.infra.commands",
  imports: [AlephaInfraLibPlugin],
  services: [InfraCommand, SecretsCommand],
});
