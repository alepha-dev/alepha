import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";

import { ProjectGitHubController } from "../../api/controllers/ProjectGitHubController.ts";
import { PullRequestController } from "../../api/controllers/PullRequestController.ts";
import { projectGitHubConnectionSchema } from "../../api/schemas/projectGitHubConnectionSchema.ts";
import { projectGitHubStatusSchema } from "../../api/schemas/projectGitHubStatusSchema.ts";
import { pullRequestStateSchema } from "../../api/schemas/pullRequestStateSchema.ts";
import { githubConnectParamsSchema } from "../schemas/githubConnectParamsSchema.ts";
import { projectParamsSchema } from "../schemas/projectParamsSchema.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * A project's GitHub repository over MCP (#Q4362), on the actions the
 * settings card calls: never more than `lore github` does.
 */
export class GitHubTools {
  protected readonly github = $inject(ProjectGitHubController);
  protected readonly projects = $inject(ProjectTools);
  protected readonly pullRequests = $inject(PullRequestController);

  github_status = $tool({
    title: "Read GitHub connection",
    description:
      "Whether this Lore instance offers GitHub (`available`), and the repository the project is connected to: owner/name, its numeric id, the installation, the default branch, who connected it, and when and why it was disconnected if it was.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: projectGitHubStatusSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.github.getProjectGitHub({ params: { projectId } });
    },
  });

  github_install = $tool({
    title: "GitHub install link",
    description:
      "The GitHub App's install page for this project (needs project:update), valid ten minutes. A person opens it in a browser: GitHub then sends them back to Lore, which proves their GitHub account reaches the repository they pick.",
    annotations: { readOnlyHint: false, idempotentHint: false },
    schema: {
      params: projectParamsSchema.strict(),
      result: z.object({ url: z.string() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.github.getProjectGitHubInstallLink({
        params: { projectId },
      });
    },
  });

  github_connect = $tool({
    title: "Connect a GitHub repository",
    description:
      "Connect the project to a repository of an installation a member of this project already connected through (needs project:update). Without one, use github_install: only the browser proves reach. A repository belongs to at most one project.",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: githubConnectParamsSchema.strict(),
      result: projectGitHubConnectionSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.github.connectProjectGitHub({
        params: { projectId },
        body: {
          installationId: params.installation_id,
          repositoryId: params.repository_id,
        },
      });
    },
  });

  github_disconnect = $tool({
    title: "Disconnect GitHub",
    description:
      "Disconnect the project's GitHub repository (needs project:update). Its links keep working; events and agent job tokens stop.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: projectGitHubStatusSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.github.disconnectProjectGitHub({
        params: { projectId },
      });
    },
  });

  pull_request_trust = $tool({
    title: "Trust a pull request",
    description:
      "Trust a pull request from outside the team (its author lacks write on the repository), by its number, so prompt triggers act on it: until then its events notify but start no agent job. Needs quest:update. Read what it changes first: trusting lets an agent act on text a stranger wrote.",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: projectParamsSchema
        .extend({
          number: z.integer().min(1).describe("The pull request's number."),
        })
        .strict(),
      result: pullRequestStateSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.pullRequests.trustPullRequest({
        params: { projectId, number: params.number },
      });
    },
  });
}
