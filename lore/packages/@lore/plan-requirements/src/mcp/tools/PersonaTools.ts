import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { PersonaController } from "../../api/controllers/PersonaController.ts";
import {
  personaCommentAddParamsSchema,
  personaCommentAddResultSchema,
  personaCreateParamsSchema,
  personaDeleteParamsSchema,
  personaDeleteResultSchema,
  personaGetParamsSchema,
  personaGetResultSchema,
  personaListParamsSchema,
  personaListResultSchema,
  personaUpdateParamsSchema,
  personaWriteResultSchema,
} from "../schemas/personaSchemas.ts";

/**
 * The persona tools of Plan's Requirements (#E153), each gated on Plan's
 * `requirements` option through `CapabilityRegistry.mcpToolOptions`, and each
 * with its `lore persona` command.
 */
export class PersonaTools {
  protected readonly personas = $inject(PersonaController);
  protected readonly projectTools = $inject(ProjectTools);

  protected async projectId(project?: number, name?: string): Promise<number> {
    return await this.projectTools.resolveProjectId(project, name);
  }

  persona_list = $tool({
    description:
      "List the personas of a project (#A2 and so on): the actors of the system it builds, a person, another system or an AI agent, with their role and the app copy they live on. Read one in full with persona_get.",
    title: "List personas",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: personaListParamsSchema,
      result: personaListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const rows = await this.personas.getPersonas({
        params: { projectId },
        query: params.kind ? { kind: params.kind } : {},
      });
      return {
        personas: rows.map((it) => ({
          id: it.id,
          number: it.number,
          kind: it.kind,
          name: it.name,
          role: it.role,
          alephaRole: it.alephaRole,
          environmentApp: it.environmentApp,
          environmentEnv: it.environmentEnv,
        })),
      };
    },
  });

  persona_get = $tool({
    description:
      "Fetch one persona by its number (2 for #A2): who they are, their goals and frustrations, the Alepha role they play, their demo account and seed, their app copy, and their discussion.",
    title: "Get persona",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: personaGetParamsSchema, result: personaGetResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const [persona, comments] = await Promise.all([
        this.personas.getPersonaByNumber({
          params: { projectId, number: params.number },
        }),
        this.personas.getPersonaComments({
          params: { projectId, number: params.number },
        }),
      ]);
      return {
        ...persona,
        comments: comments.map((it) => ({
          id: it.id,
          authorId: it.authorId,
          body: it.body,
          createdAt: it.createdAt,
        })),
      };
    },
  });

  persona_create = $tool({
    description:
      "Create a persona, an actor of the system the project builds. It is numbered #A<n> per project. Never put a password anywhere: `demoAccount` is the login alone.",
    title: "Create persona",
    schema: {
      params: personaCreateParamsSchema,
      result: personaWriteResultSchema,
    },
    handler: async ({ params }) => {
      const { project, project_name, ...body } = params;
      const projectId = await this.projectId(project, project_name);
      return await this.personas.createPersona({ params: { projectId }, body });
    },
  });

  persona_update = $tool({
    description:
      "Update a persona by its number. Omitted fields stay as they are.",
    title: "Update persona",
    schema: {
      params: personaUpdateParamsSchema,
      result: personaWriteResultSchema,
    },
    handler: async ({ params }) => {
      const { project, project_name, number, ...body } = params;
      const projectId = await this.projectId(project, project_name);
      const persona = await this.personas.byNumber(projectId, number);
      return await this.personas.updatePersona({
        params: { id: persona.id },
        body,
      });
    },
  });

  persona_delete = $tool({
    description:
      "Delete a persona by its number. Its number is never reused, so a `[[#A2]]` written elsewhere reads as a broken link.",
    title: "Delete persona",
    annotations: { destructiveHint: true },
    schema: {
      params: personaDeleteParamsSchema,
      result: personaDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const persona = await this.personas.byNumber(projectId, params.number);
      await this.personas.deletePersona({ params: { id: persona.id } });
      return { ok: true, number: params.number };
    },
  });

  persona_comment_add = $tool({
    description:
      "Comment on a persona, as yourself; recorded as agent-authored. ⚠️ `@name` reaches a project member's inbox and e-mail.",
    title: "Comment on persona",
    schema: {
      params: personaCommentAddParamsSchema,
      result: personaCommentAddResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const persona = await this.personas.byNumber(projectId, params.number);
      const comment = await this.personas.addPersonaComment({
        params: { id: persona.id },
        body: { body: params.body, agent: true, agentClient: params.as },
      });
      return { id: comment.id, createdAt: comment.createdAt };
    },
  });
}
