import type { PullRequestController } from "@lore/core/api";
import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore pull-request trust <number>` (#Q4368): a member trusts a pull
 * request from outside the team, so prompt triggers act on it, as
 * `pull_request_trust` does.
 */
export class PullRequestCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<PullRequestController>(this.client.scope());

  public readonly trust = $command({
    name: "trust",
    description:
      "Trust a pull request from outside the team, by number, so prompt triggers act on it (quest:update)",
    args: z.text({ title: "number", description: "The pull request's number" }),
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const number = Number(String(args).replace(/^#/, ""));
      if (!Number.isInteger(number) || number < 1) {
        throw new AlephaError("Give the pull request's number, e.g. 118");
      }
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const state = await this.api.trustPullRequest({
          params: { projectId, number },
        });
        if (flags.output === "json") {
          this.render.json(print, state);
          return;
        }
        print(`Trusted #${state.number} ${state.title}`);
      });
    },
  });

  public readonly pullRequest = $command({
    name: "pull-request",
    description: "A pull request of the project's GitHub repository",
    children: [this.trust],
    handler: async ({ help }) => {
      help();
    },
  });
}
