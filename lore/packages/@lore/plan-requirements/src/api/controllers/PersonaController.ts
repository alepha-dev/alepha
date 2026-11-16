import { $ownsProject, BestEffort, LoreAudits } from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject, z } from "alepha";
import { $repository, $sequence } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { type Persona, personas } from "../entities/personas.ts";
import { personaInputSchema } from "../schemas/personaInputSchema.ts";
import { personaKindSchema } from "../schemas/personaKindSchema.ts";
import { personaResourceSchema } from "../schemas/personaResourceSchema.ts";
import { requirementsCommentResourceSchema } from "../schemas/requirementsCommentResourceSchema.ts";
import { RequirementsCommentService } from "../services/RequirementsCommentService.ts";

/**
 * Personas (#E153): list, read, create, update, delete and comment.
 *
 * Reads are open to `persona:read`, the Viewer rank included (answer 22);
 * writes need `persona:write` and Plan's `requirements` option, since a
 * disabled surface hides and never deletes.
 */
export class PersonaController {
  protected readonly personas = $repository(personas);
  protected readonly audits = $inject(LoreAudits);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly comments = $inject(RequirementsCommentService);
  protected readonly bestEffort = $inject(BestEffort);

  /**
   * The per-project number. ⚠️ `$sequence` keys its counter on this
   * PROPERTY NAME: renaming it restarts every project's count.
   */
  protected personaNumber = $sequence();

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId" });

  protected ownsProjectForWrite = (requires: string) =>
    $ownsProject({
      requires,
      param: "projectId",
      capability: {
        key: "plan",
        option: "requirements",
        action: "write a persona",
      },
    });

  protected ownsPersonaForWrite = (requires: string) =>
    $ownsProject({
      requires,
      repository: () => this.personas,
      param: "id",
      capability: {
        key: "plan",
        option: "requirements",
        action: "write a persona",
      },
    });

  /**
   * One audit row, addressed by the persona's number, as its page is.
   */
  protected async log(
    action: string,
    persona: Pick<Persona, "number" | "name" | "projectId">,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    await this.audits.persona.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(persona.projectId),
      resourceType: "persona",
      resourceId: String(persona.number),
      description: persona.name,
    });
  }

  getPersonas = $action({
    method: "GET",
    path: "/getPersonas/:projectId",
    use: [this.ownsProject("persona:read")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ kind: personaKindSchema.optional() }),
      response: z.array(personaResourceSchema),
    },
    handler: async ({ params, query }) =>
      await this.personas.findMany({
        where: {
          projectId: { eq: params.projectId },
          ...(query.kind ? { kind: { eq: query.kind } } : {}),
        },
        orderBy: [{ column: "number", direction: "asc" }],
      }),
  });

  getPersonaByNumber = $action({
    method: "GET",
    path: "/getPersona/:projectId/:number",
    use: [this.ownsProject("persona:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: personaResourceSchema,
    },
    handler: async ({ params }) =>
      await this.byNumber(params.projectId, params.number),
  });

  createPersona = $action({
    method: "POST",
    path: "/createPersona/:projectId",
    use: [this.ownsProjectForWrite("persona:write")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: personaInputSchema.required({ name: true }),
      response: personaResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const number = await this.personaNumber.next(String(params.projectId));
      const persona = await this.personas.create({
        ...body,
        projectId: params.projectId,
        number,
      });
      await this.log("create", persona, user);
      return persona;
    },
  });

  updatePersona = $action({
    method: "POST",
    path: "/updatePersona/:id",
    use: [this.ownsPersonaForWrite("persona:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: personaInputSchema,
      response: personaResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const persona = await this.personas.updateById(params.id, body);
      await this.log("update", persona, user);
      return persona;
    },
  });

  /**
   * A soft delete, as quests and epics: the number is never reused, so a
   * `[[#A2]]` written before reads as a broken link rather than as somebody
   * else.
   */
  deletePersona = $action({
    method: "POST",
    path: "/deletePersona/:id",
    use: [this.ownsPersonaForWrite("persona:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const persona = this.owned.get<Persona>();
      await this.personas.deleteById(params.id);
      await this.bestEffort.run("deletePersona: comments", () =>
        this.comments.deleteOf("persona", persona.id),
      );
      await this.log("delete", persona, user);
      return { ok: true };
    },
  });

  getPersonaComments = $action({
    method: "GET",
    path: "/getPersonaComments/:projectId/:number",
    use: [this.ownsProject("persona:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: z.array(requirementsCommentResourceSchema),
    },
    handler: async ({ params }) => {
      const persona = await this.byNumber(params.projectId, params.number);
      return await this.comments.list("persona", persona.id);
    },
  });

  addPersonaComment = $action({
    method: "POST",
    path: "/addPersonaComment/:id",
    use: [this.ownsPersonaForWrite("persona:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
        /**
         * Set by the MCP tool: an agent wrote it, so a self-mention reaches
         * the key's owner, as on a quest comment.
         */
        agentClient: z.text().optional(),
        agent: z.boolean().optional(),
      }),
      response: requirementsCommentResourceSchema,
    },
    handler: async ({ body, user }) => {
      const persona = this.owned.get<Persona>();
      const project = this.owned.authority<Project>();
      const slug = project.slug || `project-${project.id}`;
      const comment = await this.comments.add({
        projectId: persona.projectId,
        subjectKind: "persona",
        subjectId: persona.id,
        body: body.body,
        user,
        subject: {
          projectId: persona.projectId,
          projectTitle: project.title,
          reference: formatReference("persona", persona.number),
          title: persona.name,
          href: `/${slug}/requirements/personas/${persona.number}`,
        },
        agent: body.agent ? { client: body.agentClient } : undefined,
      });
      await this.log("comment", persona, user);
      return comment;
    },
  });

  /**
   * A live persona of the project by its number, or a 404.
   */
  public async byNumber(projectId: number, number: number): Promise<Persona> {
    const [persona] = await this.personas.findMany({
      where: { projectId: { eq: projectId }, number: { eq: number } },
      limit: 1,
    });
    if (!persona) {
      throw new NotFoundError(`Persona #A${number} not found`);
    }
    return persona;
  }
}
