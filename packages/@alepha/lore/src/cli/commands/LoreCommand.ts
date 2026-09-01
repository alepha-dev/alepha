import { $inject } from "alepha";
import { $command } from "alepha/command";

import { ArtifactCommand } from "./ArtifactCommand.ts";
import { LoginCommand } from "./LoginCommand.ts";
import { QualityCommand } from "./QualityCommand.ts";

/**
 * `alepha lore` - the root, and the only place it may be declared.
 *
 * ## ⚠️ Two classes cannot both declare it
 *
 * `CliProvider.findCommand` resolves a name with `findLast`, so a second
 * command called `lore` does not collide loudly: it SHADOWS the first, and the
 * subtree that lost simply stops existing. `quality` used to own this root
 * because it was the only verb; `artifacts` arriving is what made the root a
 * thing of its own rather than a field on whichever command came first.
 *
 * The children are primitives held by other instances, which `$command`
 * supports directly - `getTopLevelCommands` subtracts children by identity, so
 * neither subtree turns up beside `lore` in the general help.
 *
 * ## ⚠️ NOT re-exported from `index.ts`
 *
 * It names two classes that name types from the private `lore` workspace. Same
 * rule as `QualityCommand`, enforced by `scripts/check-dts.mjs`.
 */
export class LoreCommand {
  protected readonly quality = $inject(QualityCommand);
  protected readonly artifacts = $inject(ArtifactCommand);
  protected readonly auth = $inject(LoginCommand);

  /**
   * ⚠️ Declared after both injections. A `children: [...]` entry reading
   * another field is a field initializer, so an injection declared below it is
   * `undefined` at construction time.
   */
  public readonly lore = $command({
    name: "lore",
    description: "Talk to a Lore instance",
    // `login` and `logout` sit directly under `lore` rather than under a verb
    // of their own: they are about the connection to an instance, not about a
    // subject within it, and `alepha lore auth login` would be a noun invented
    // to hold two commands.
    children: [
      this.quality.quality,
      this.artifacts.artifacts,
      this.auth.login,
      this.auth.logout,
    ],
    handler: async ({ help }) => {
      help();
    },
  });
}
