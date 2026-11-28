import type {
  AdminGitHubController,
  ProjectGitHubController,
} from "@lore/core/api";
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
 * `lore github` (epic #E177): the instance's GitHub App, and the
 * repositories projects connect to it.
 *
 * `lore github app` (#Q4360) reads the App's status the way Admin > GitHub
 * shows it: where it comes from, its slug, install link and webhook URL.
 * Never a secret, and an instance admin's key only.
 *
 * `status`, `install`, `connect` and `disconnect` (#Q4362) are a project's
 * repository, the `github_*` MCP tools' twins. `connect` takes an
 * installation a member of the project already connected through: a first
 * connection is made in the browser, which proves the member reaches the
 * repository.
 */
export class GitHubCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly projects = $inject(LoreProjectResolver);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly admin = $client<AdminGitHubController>(
    this.client.scope(),
  );

  protected readonly api = $client<ProjectGitHubController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly status = $command({
    name: "status",
    description:
      "Whether the instance offers GitHub, and the repository the project is connected to",
    flags: z.object({ ...GitHubCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const status = await this.api.getProjectGitHub({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, status);
          return;
        }
        this.show(print, status);
      });
    },
  });

  public readonly install = $command({
    name: "install",
    description:
      "Print the GitHub App's install link for the project (project:update), to open in a browser",
    flags: z.object({ ...GitHubCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const link = await this.api.getProjectGitHubInstallLink({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, link);
          return;
        }
        print(link.url);
      });
    },
  });

  public readonly connect = $command({
    name: "connect",
    description:
      "Connect a repository of an installation a member of the project already connected through (project:update)",
    flags: z.object({
      ...GitHubCommand.PROJECT_FLAG,
      "installation-id": z.text({
        description:
          "The GitHub App installation (lore github status shows the current one)",
      }),
      "repository-id": z.text({
        description: "GitHub's numeric id of the repository",
      }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const installationId = this.id(
        flags["installation-id"],
        "--installation-id",
      );
      const repositoryId = this.id(flags["repository-id"], "--repository-id");
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const connection = await this.api.connectProjectGitHub({
          params: { projectId },
          body: { installationId, repositoryId },
        });
        if (flags.output === "json") {
          this.render.json(print, connection);
          return;
        }
        print(`Connected ${connection.fullName}`);
      });
    },
  });

  public readonly disconnect = $command({
    name: "disconnect",
    description: "Disconnect the project's GitHub repository (project:update)",
    flags: z.object({ ...GitHubCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const status = await this.api.disconnectProjectGitHub({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, status);
          return;
        }
        print("Disconnected");
      });
    },
  });

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
    children: [
      this.status,
      this.install,
      this.connect,
      this.disconnect,
      this.app,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  protected id(raw: string, flag: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new AlephaError(`${flag} is a positive whole number`);
    }
    return value;
  }

  protected show(
    print: (message?: string) => void,
    status: Awaited<ReturnType<ProjectGitHubController["getProjectGitHub"]>>,
  ): void {
    if (!status.available) {
      print("GitHub is not set up on this Lore instance.");
    }
    const connection = status.connection;
    if (!connection) {
      print("Not connected.");
      return;
    }
    print(
      `Repository: ${connection.fullName} (id ${connection.repositoryId}, installation ${connection.installationId})`,
    );
    print(`Default branch: ${connection.defaultBranch}`);
    print(
      connection.connected
        ? `Connected ${connection.connectedAt}${connection.connectedBy?.name ? ` by ${connection.connectedBy.name}` : ""}`
        : `Disconnected ${connection.disconnectedAt ?? ""} (${connection.disconnectReason ?? "member"})`,
    );
  }
}
