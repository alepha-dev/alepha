import { $inject } from "alepha";
import { CommandError } from "alepha/command";

import { LoreRefusals } from "../LoreRefusals.ts";
import type { EstateProvider } from "./EstateProvider.ts";
import { ScalewayProvider } from "./ScalewayProvider.ts";

/**
 * The providers `lore estate provision --provider` knows (#Q3164). A new
 * one is a class beside {@link ScalewayProvider} and a line in {@link all}.
 */
export class EstateProviders {
  protected readonly scaleway = $inject(ScalewayProvider);

  all(): EstateProvider[] {
    return [this.scaleway];
  }

  /**
   * The provider named `--provider`. No name, or one not known, refuses with
   * the list and what each needs, since that is the page an agent would
   * otherwise have to find.
   */
  pick(name: string | undefined): EstateProvider {
    const found = this.all().find((provider) => provider.name === name);
    if (found) {
      return found;
    }
    const lead =
      name === undefined
        ? "Name the provider to buy the server from, with --provider:"
        : `Unknown provider ${name}. The providers are:`;
    throw new CommandError(
      { exitCode: LoreRefusals.EXIT_FAILURE },
      { message: `${lead}\n\n${this.describe()}` },
    );
  }

  /**
   * Every provider, its title, and the commands to run once before it works.
   */
  describe(): string {
    return this.all()
      .map((provider) =>
        [
          `  ${provider.name}  ${provider.title}`,
          "    once:",
          ...provider.setup.map((line) => `      ${line}`),
          `    then: lore estate provision --provider ${provider.name}`,
        ].join("\n"),
      )
      .join("\n\n");
  }
}
