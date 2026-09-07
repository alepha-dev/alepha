import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { projectPrompts } from "../entities/projectPrompts.ts";
import { agentPromptKindSchema } from "../schemas/agentPromptKindSchema.ts";
import { projectPromptResourceSchema } from "../schemas/projectPromptResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { LoreAudits } from "../services/LoreAudits.ts";

/**
 * A project's customised agent prompts: read them, write one, reset one.
 *
 * ⚠️ **Only the rows that exist are returned.** A kind with no row is not
 * absent from the answer by accident; it means the project follows the
 * built-in default, and the client fills it in. Answering the defaults from
 * here would make the server the source of a text the browser already has,
 * and would make Reset indistinguishable from a customisation that happens
 * to match.
 *
 * Reading is member-gated and writing is owner-gated, the split the rest of
 * the project's configuration already uses: a member reads what the project
 * hands agents, the owner decides it.
 */
export class ProjectPromptController {
  protected readonly prompts = $repository(projectPrompts);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Declared above the actions on purpose: a `use: [...]` entry reading
   * another field is a field initializer, so a gate declared below its first
   * use is `undefined` at construction time.
   */
  protected ownsAsMember = () => $ownsProject({ param: "projectId" });
  protected ownsAsOwner = () =>
    $ownsProject({ param: "projectId", owner: true });

  getProjectPrompts = $action({
    use: [$secure({ permissions: ["project:read"] }), this.ownsAsMember()],
    method: "GET",
    path: "/projects/:projectId/prompts",
    description: "The agent prompt templates this project has customised.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.array(projectPromptResourceSchema),
    },
    handler: async ({ params }) => {
      const rows = await this.prompts.findMany({
        where: { projectId: { eq: params.projectId } },
      });
      return rows.map((it) => ({ kind: it.kind, template: it.template }));
    },
  });

  /**
   * Write one kind's template.
   *
   * An upsert rather than a create plus an update, because the caller is
   * editing a prompt and does not know or care whether this project has ever
   * customised that one before. The unique index on `(projectId, kind)` is
   * what makes "one row per kind" true rather than hoped for.
   *
   * The kind is the closed enum, so an unknown one is a 400 from the schema
   * rather than a row nobody will ever read back.
   */
  setProjectPrompt = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    method: "PUT",
    path: "/projects/:projectId/prompts/:kind",
    description: "Set one agent prompt template for a project.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        kind: agentPromptKindSchema,
      }),
      body: z.object({
        template: projectPrompts.schema.shape.template,
      }),
      response: projectPromptResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const existing = await this.prompts.findOne({
        where: {
          projectId: { eq: params.projectId },
          kind: { eq: params.kind },
        },
      });

      if (existing) {
        existing.template = body.template;
        await this.prompts.save(existing);
      } else {
        await this.prompts.create({
          projectId: params.projectId,
          kind: params.kind,
          template: body.template,
        });
      }

      // The template itself is deliberately NOT in the metadata: it runs to
      // 20 000 characters, and the audit row answers "who changed which
      // prompt, when", not "to what".
      await this.audits.project.logSuccess("update", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        resourceType: "project",
        resourceId: String(params.projectId),
        metadata: { prompt: params.kind },
      });

      return { kind: params.kind, template: body.template };
    },
  });

  /**
   * Drop one kind's row, so the project follows the built-in default again.
   *
   * Deleting rather than writing the default in: a project that has reset a
   * prompt keeps following the shipped text as it improves, and "reset" stays
   * distinguishable from "customised to exactly today's default".
   *
   * Deleting a row that is not there is a success, not a 404. The caller is
   * asking for a state, and that state already holds.
   */
  resetProjectPrompt = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    method: "DELETE",
    path: "/projects/:projectId/prompts/:kind",
    description: "Restore one agent prompt template to its built-in default.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        kind: agentPromptKindSchema,
      }),
      response: z.object({ kind: agentPromptKindSchema }),
    },
    handler: async ({ params, user }) => {
      const existing = await this.prompts.findOne({
        where: {
          projectId: { eq: params.projectId },
          kind: { eq: params.kind },
        },
      });

      if (existing) {
        await this.prompts.deleteById(existing.id);
        await this.audits.project.logSuccess("update", {
          ...this.audits.actor(user),
          ...this.audits.scope(params.projectId),
          resourceType: "project",
          resourceId: String(params.projectId),
          metadata: { prompt: params.kind, reset: true },
        });
      }

      return { kind: params.kind };
    },
  });
}
