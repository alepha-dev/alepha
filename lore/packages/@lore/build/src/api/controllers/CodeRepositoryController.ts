import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { codeRepositoryCreateSchema } from "../schemas/codeRepositoryCreateSchema.ts";
import { codeRepositorySchema } from "../schemas/codeRepositorySchema.ts";
import { codeRepositorySlugSchema } from "../schemas/codeRepositorySlugSchema.ts";
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
 * permission that no OAuth token carries (`LoreOAuthScopes.PARTIAL_GROUPS`),
 * so a CLI login or an MCP client is refused with 403 and a repository is
 * deleted with a signed-in session or an API key. Both writes need the
 * `build` capability (400 without); the read stays open, as every read of
 * existing data does.
 */
export class CodeRepositoryController {
  protected readonly repositories = $inject(CodeRepositoryService);

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
      capability: { key: "build", action },
    });

  listCodeRepositories = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos",
    description: "The project's git repositories, with their clone URLs.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ repositories: z.array(codeRepositorySchema) }),
    },
    handler: async ({ params, url }) => {
      const base = this.repositories.baseUrl(url);
      const rows = await this.repositories.list(params.projectId);
      return {
        repositories: await Promise.all(
          rows.map((row) => this.repositories.toResource(row, base)),
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
      "Delete a git repository and everything in it. Needs code:admin, which no CLI login or MCP token holds: use a signed-in session or an API key.",
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
