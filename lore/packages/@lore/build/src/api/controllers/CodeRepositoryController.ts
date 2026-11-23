import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { codeRepositoryCreateSchema } from "../schemas/codeRepositoryCreateSchema.ts";
import { codeRepositorySchema } from "../schemas/codeRepositorySchema.ts";
import { codeRepositorySlugSchema } from "../schemas/codeRepositorySlugSchema.ts";
import { CodeBrowserService } from "../services/CodeBrowserService.ts";
import { CodeReadAccess } from "../services/CodeReadAccess.ts";
import { CodeRepositoryService } from "../services/CodeRepositoryService.ts";

/**
 * A project's git repositories, over the API (#E162): what `lore code repo
 * list|create|delete` and the `code_repo_*` tools call.
 *
 * ## ⚠️ Action names are the wire contract
 *
 * The CLI resolves an action by name against `/api/_links`: rename one only
 * on purpose.
 *
 * ## Who may do what
 *
 * Listing is `code:read`; creating and deleting are `code:admin`, an Admin's
 * permission. A `lore login` holds it (`LoreOAuthScopes.CLI_ONLY_PERMISSIONS`)
 * and an MCP client does not, so over MCP both answer 403 and a repository
 * is created from the CLI, a signed-in session or an API key. Both writes need the
 * `build` capability (400 without). The list 404s with Build's
 * `repositories` off (#Q4133), as every code read does (`CodeReadAccess`),
 * and a job key lists the one repository it is pinned to.
 */
export class CodeRepositoryController {
  protected readonly repositories = $inject(CodeRepositoryService);
  protected readonly access = $inject(CodeReadAccess);
  protected readonly browser = $inject(CodeBrowserService);

  /**
   * Declared above the actions: a `use: [...]` entry reading a field is a
   * field initializer.
   */
  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "code:read" });
  protected adminGate = (action: string) =>
    $ownsProject({
      param: "projectId",
      requires: "code:admin",
      capability: { key: "build", option: "repositories", action },
    });

  listCodeRepositories = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos",
    description:
      "The project's git repositories, with their clone URLs and the default branch's last commit.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ repositories: z.array(codeRepositorySchema) }),
    },
    handler: async ({ params, url, user }) => {
      await this.access.assertRepositories(params.projectId);
      const base = this.repositories.baseUrl(url);
      const rows = await this.access.readable(
        await this.repositories.list(params.projectId),
        user,
      );
      return {
        repositories: await Promise.all(
          rows.map(async (row) => ({
            ...(await this.repositories.toResource(row, base)),
            lastCommit: await this.browser.head(row),
          })),
        ),
      };
    },
  });

  createCodeRepository = $action({
    use: [this.adminGate("create a repository")],
    method: "POST",
    path: "/projects/:projectId/code/repos",
    description: "Create an empty git repository in the project.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: codeRepositoryCreateSchema,
      response: codeRepositorySchema,
    },
    handler: async ({ params, body, user, url }) => {
      const row = await this.repositories.create({
        projectId: params.projectId,
        slug: body.slug,
        defaultBranch: body.defaultBranch,
        createdBy: user?.id,
      });
      return this.repositories.toResource(row, this.repositories.baseUrl(url));
    },
  });

  deleteCodeRepository = $action({
    use: [this.adminGate("delete a repository")],
    method: "DELETE",
    path: "/projects/:projectId/code/repos/:slug",
    description:
      "Delete a git repository and everything in it. Needs code:admin: a project Admin's lore login, signed-in session or API key. An MCP token never holds it.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        slug: codeRepositorySlugSchema,
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      await this.repositories.delete(params.projectId, params.slug);
      return { ok: true };
    },
  });
}
