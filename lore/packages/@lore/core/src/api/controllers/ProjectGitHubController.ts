import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { githubConnectBodySchema } from "../schemas/githubConnectBodySchema.ts";
import { githubConnectCallbackBodySchema } from "../schemas/githubConnectCallbackBodySchema.ts";
import { githubConnectCallbackResultSchema } from "../schemas/githubConnectCallbackResultSchema.ts";
import { githubInstallLinkSchema } from "../schemas/githubInstallLinkSchema.ts";
import { projectGitHubConnectionSchema } from "../schemas/projectGitHubConnectionSchema.ts";
import { projectGitHubStatusSchema } from "../schemas/projectGitHubStatusSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectRepositoryService } from "../services/ProjectRepositoryService.ts";

/**
 * A project's GitHub repository (#Q4362, epic #E177): read with
 * `project:read`, connected and disconnected with `project:update`, the
 * permission that edits the repository URL. The install callback is not
 * project-scoped by its path: its state names the project and the member,
 * and the service checks the permission again.
 */
export class ProjectGitHubController {
  protected readonly service = $inject(ProjectRepositoryService);

  getProjectGitHub = $action({
    use: [$ownsProject({ param: "projectId", requires: "project:read" })],
    method: "GET",
    path: "/projects/:projectId/github",
    description:
      "Whether the instance offers GitHub, and the repository the project is connected to",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: projectGitHubStatusSchema,
    },
    handler: async ({ params }) => await this.service.status(params.projectId),
  });

  getProjectGitHubInstallLink = $action({
    use: [$ownsProject({ param: "projectId", requires: "project:update" })],
    method: "POST",
    path: "/projects/:projectId/github/install",
    description:
      "The GitHub App's install page for this project, valid ten minutes",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: githubInstallLinkSchema,
    },
    handler: async ({ params, user }) => ({
      url: await this.service.installLink(params.projectId, user!.id),
    }),
  });

  completeGitHubInstall = $action({
    use: [$secure()],
    method: "POST",
    path: "/github/connect",
    description:
      "GitHub's return after an install: connects the repository, or offers the ones the member reaches",
    schema: {
      body: githubConnectCallbackBodySchema,
      response: githubConnectCallbackResultSchema,
    },
    handler: async ({ body, user }) => await this.service.callback(user!, body),
  });

  connectProjectGitHub = $action({
    use: [$ownsProject({ param: "projectId", requires: "project:update" })],
    method: "POST",
    path: "/projects/:projectId/github/connect",
    description:
      "Connect one repository: from the install's choice, or through an installation a member of this project already connected",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: githubConnectBodySchema,
      response: projectGitHubConnectionSchema,
    },
    handler: async ({ params, body, user }) =>
      await this.service.connect(params.projectId, user!, body),
  });

  disconnectProjectGitHub = $action({
    use: [$ownsProject({ param: "projectId", requires: "project:update" })],
    method: "POST",
    path: "/projects/:projectId/github/disconnect",
    description: "Disconnect the project's GitHub repository",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: projectGitHubStatusSchema,
    },
    handler: async ({ params, user }) =>
      await this.service.disconnect(params.projectId, user),
  });
}
