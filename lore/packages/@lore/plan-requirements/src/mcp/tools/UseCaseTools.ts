import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError } from "alepha/server";

import { PersonaController } from "../../api/controllers/PersonaController.ts";
import { RunController } from "../../api/controllers/RunController.ts";
import { UseCaseController } from "../../api/controllers/UseCaseController.ts";
import type { UseCaseInput } from "../../api/schemas/useCaseInputSchema.ts";
import {
  type ScenarioFields,
  useCaseCommentAddParamsSchema,
  useCaseCommentAddResultSchema,
  useCaseCreateParamsSchema,
  useCaseDeleteParamsSchema,
  useCaseDeleteResultSchema,
  useCaseGetParamsSchema,
  useCaseGetResultSchema,
  useCaseLinkEpicParamsSchema,
  useCaseListParamsSchema,
  useCaseListResultSchema,
  useCaseUpdateParamsSchema,
  useCaseRunRecordParamsSchema,
  useCaseRunRecordResultSchema,
  useCaseValidateParamsSchema,
  useCaseWriteResultSchema,
} from "../schemas/useCaseSchemas.ts";

/**
 * The use case tools of Plan's Requirements (#E153), each with its
 * `lore usecase` command. They speak persona and epic NUMBERS, as every
 * Lore tool does, and translate them to ids for the actions.
 */
export class UseCaseTools {
  protected readonly useCases = $inject(UseCaseController);
  protected readonly personas = $inject(PersonaController);
  protected readonly runs = $inject(RunController);
  protected readonly projectTools = $inject(ProjectTools);

  protected async projectId(project?: number, name?: string): Promise<number> {
    return await this.projectTools.resolveProjectId(project, name);
  }

  /**
   * The scenario fields in persona ids, as the actions take them.
   */
  protected async inputOf(
    projectId: number,
    fields: ScenarioFields,
  ): Promise<UseCaseInput> {
    const numbers = [
      ...(fields.actors ?? []).map((it) => it.persona),
      ...(fields.steps ?? []).flatMap((it) =>
        it.actor === undefined ? [] : [it.actor],
      ),
    ];
    const ids = new Map<number, number>();
    if (numbers.length) {
      const all = await this.personas.getPersonas({
        params: { projectId },
        query: {},
      });
      for (const persona of all) ids.set(persona.number, persona.id);
      const missing = numbers.filter((n) => !ids.has(n));
      if (missing.length) {
        throw new BadRequestError(`No persona #A${missing[0]} in this project`);
      }
    }
    const { actors, steps, ...rest } = fields;
    return {
      ...rest,
      ...(actors
        ? {
            actors: actors.map((it) => ({
              personaId: ids.get(it.persona)!,
              role: it.role,
            })),
          }
        : {}),
      ...(steps
        ? {
            steps: steps.map((it) => ({
              actorPersonaId:
                it.actor === undefined ? undefined : ids.get(it.actor),
              text: it.text,
            })),
          }
        : {}),
    };
  }

  usecase_list = $tool({
    description:
      "List the use cases of a project (#U7 and so on): scenarios played by personas, with their status, actors, covering epics and how many acceptance criteria they hold. Read one in full with usecase_get.",
    title: "List use cases",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: useCaseListParamsSchema,
      result: useCaseListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const rows = await this.useCases.getUseCases({
        params: { projectId },
        query: params.status ? { status: params.status } : {},
      });
      return {
        useCases: rows.map((it) => ({
          id: it.id,
          number: it.number,
          title: it.title,
          status: it.status,
          priority: it.priority,
          actors: it.actors.map((a) => `#A${a.number}`),
          coveredBy: it.coveredBy.map((e) => e.number),
          criteria: it.criteria.length,
          scenarioVersion: it.scenarioVersion,
        })),
      };
    },
  });

  usecase_get = $tool({
    description:
      "Fetch one use case by its number (7 for #U7): preconditions, actors, the steps in order with who acts each, alternatives, acceptance criteria with their keys (C1...) and how each is verified, the epics covering it, and its discussion.",
    title: "Get use case",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: useCaseGetParamsSchema, result: useCaseGetResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const [useCase, comments] = await Promise.all([
        this.useCases.getUseCaseByNumber({
          params: { projectId, number: params.number },
        }),
        this.useCases.getUseCaseComments({
          params: { projectId, number: params.number },
        }),
      ]);
      return {
        ...useCase,
        comments: comments.map((it) => ({
          id: it.id,
          body: it.body,
          createdAt: it.createdAt,
        })),
      };
    },
  });

  usecase_create = $tool({
    description:
      "Create a use case, as a draft: its title, actors (persona numbers), steps, alternatives and acceptance criteria. Criteria keys (C1, C2...) are assigned and never reused.",
    title: "Create use case",
    schema: {
      params: useCaseCreateParamsSchema,
      result: useCaseWriteResultSchema,
    },
    handler: async ({ params }) => {
      const { project, project_name, ...fields } = params;
      const projectId = await this.projectId(project, project_name);
      const body = await this.inputOf(projectId, fields);
      return await this.useCases.createUseCase({
        params: { projectId },
        body: { ...body, title: fields.title },
      });
    },
  });

  usecase_update = $tool({
    description:
      "Update a use case by its number. Each list sent (actors, steps, alternatives, criteria) REPLACES the current one; omitted fields stay. Pass a criterion's key to keep it. Editing a step or a criterion bumps the scenario version and returns a validated use case to ready.",
    title: "Update use case",
    schema: {
      params: useCaseUpdateParamsSchema,
      result: useCaseWriteResultSchema,
    },
    handler: async ({ params }) => {
      const { project, project_name, number, ...fields } = params;
      const projectId = await this.projectId(project, project_name);
      const useCase = await this.useCases.byNumber(projectId, number);
      return await this.useCases.updateUseCase({
        params: { id: useCase.id },
        body: await this.inputOf(projectId, fields),
      });
    },
  });

  usecase_delete = $tool({
    description: "Delete a use case by its number. Its number is never reused.",
    title: "Delete use case",
    annotations: { destructiveHint: true },
    schema: {
      params: useCaseDeleteParamsSchema,
      result: useCaseDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const useCase = await this.useCases.byNumber(projectId, params.number);
      await this.useCases.deleteUseCase({ params: { id: useCase.id } });
      return { ok: true, number: params.number };
    },
  });

  usecase_comment_add = $tool({
    description:
      "Comment on a use case, as yourself; recorded as agent-authored. ⚠️ `@name` reaches a project member's inbox and e-mail.",
    title: "Comment on use case",
    schema: {
      params: useCaseCommentAddParamsSchema,
      result: useCaseCommentAddResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const useCase = await this.useCases.byNumber(projectId, params.number);
      const comment = await this.useCases.addUseCaseComment({
        params: { id: useCase.id },
        body: { body: params.body, agent: true, agentClient: params.as },
      });
      return { id: comment.id, createdAt: comment.createdAt };
    },
  });

  usecase_validate = $tool({
    description:
      "Answer a use case's validation: validated, or changes_requested (back to draft) with a note. Needs usecase:validate, which the project owner and Admins hold by default.",
    title: "Validate use case",
    schema: {
      params: useCaseValidateParamsSchema,
      result: useCaseWriteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const useCase = await this.useCases.byNumber(projectId, params.number);
      return await this.useCases.validateUseCase({
        params: { id: useCase.id },
        body: { decision: params.decision, note: params.note },
      });
    },
  });

  usecase_run_record = $tool({
    description:
      "Record a run of a use case you played: one result per acceptance criterion (passed, failed, not_run), where (app and env, or local) and a note. A failed criterion opens an error only once every quest covering the use case is completed and the project tracks errors; a later pass resolves it. Fix nothing while testing. Attach screenshots or a recording with `lore attachments push --run <runId>`.",
    title: "Record use case run",
    schema: {
      params: useCaseRunRecordParamsSchema,
      result: useCaseRunRecordResultSchema,
    },
    handler: async ({ params }) => {
      const { project, project_name, number, ...body } = params;
      const projectId = await this.projectId(project, project_name);
      const recorded = await this.runs.recordUseCaseRun({
        params: { projectId },
        body: { ...body, useCaseNumber: number },
      });
      return {
        runId: recorded.run.id,
        errorsOpened: recorded.errorsOpened,
        errorRule: recorded.errorRule,
      };
    },
  });

  usecase_link_epic = $tool({
    description:
      "Make an epic cover a use case (the epic delivers it), or stop covering it with linked: false. Coverage is what development progress and a run's error rule read.",
    title: "Link use case to epic",
    schema: {
      params: useCaseLinkEpicParamsSchema,
      result: useCaseWriteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const useCase = await this.useCases.byNumber(projectId, params.number);
      return await this.useCases.linkUseCaseEpic({
        params: { id: useCase.id },
        body: { epicNumber: params.epic_number, linked: params.linked ?? true },
      });
    },
  });
}
