import type { AdminGitHubController } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore github` (epic #E177): the instance's GitHub App, and the
 * repositories projects connect to it.
 *
 * `lore github app` (#Q4360) reads the App's status the way Admin > GitHub
 * shows it: where it comes from, its slug, install link and webhook URL.
 * Never a secret, and an instance admin's key only.
 */
export class GitHubCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly admin = $client<AdminGitHubController>(
    this.client.scope(),
  );

  public readonly app = $command({
    name: "app",
    description:
      "The instance's GitHub App: its source, slug, install link and webhook (an instance admin's key)",
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const status = await this.admin.getGitHubApp({});
        if (flags.output === "json") {
          this.render.json(print, status);
          return;
        }
        if (!status.configured) {
          print("No GitHub App on this instance.");
          if (status.missing?.length) {
            print(`Missing environment: ${status.missing.join(", ")}`);
          }
          print(`Webhook URL: ${status.webhookUrl ?? "PUBLIC_URL is not set"}`);
          return;
        }
        print(
          `App: ${status.name ?? status.slug} (${status.slug}, id ${status.appId})`,
        );
        print(`Source: ${status.source}`);
        if (status.ownerLogin) print(`Owner: ${status.ownerLogin}`);
        if (status.installUrl) print(`Install: ${status.installUrl}`);
        print(`Webhook URL: ${status.webhookUrl ?? "PUBLIC_URL is not set"}`);
        print(
          `Webhook: ${status.webhookPingAt ? `reached ${status.webhookPingAt}` : "not reached yet"}`,
        );
      });
    },
  });

  public readonly github = $command({
    name: "github",
    description: "The GitHub App and the repository a project connects",
    children: [this.app],
    handler: async ({ help }) => {
      help();
    },
  });
}
