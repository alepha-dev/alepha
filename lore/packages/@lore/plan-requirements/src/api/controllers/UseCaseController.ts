import {
  $ownsProject,
  BestEffort,
  BoundParameters,
  LoreAudits,
  LoreInboxNotifications,
  ProjectRoster,
  ResourceLinkService,
  ResourceRegistry,
} from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { quests } from "@lore/plan/schemas";
import { $inject, Alepha, z } from "alepha";
import { RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { type UseCase, useCases } from "../entities/useCases.ts";
import { requirementsCommentResourceSchema } from "../schemas/requirementsCommentResourceSchema.ts";
import { useCaseInputSchema } from "../schemas/useCaseInputSchema.ts";
import { useCaseResourceSchema } from "../schemas/useCaseResourceSchema.ts";
import { useCaseStatusSchema } from "../schemas/useCaseStatusSchema.ts";
import { RequirementsCommentService } from "../services/RequirementsCommentService.ts";
import { RequirementService } from "../services/RequirementService.ts";
import { UseCaseService } from "../services/UseCaseService.ts";

/**
 * Use cases (#E153): list, read, create, update (the scenario included),
 * delete, comment, and the epics covering them.
 *
 * Reads need `usecase:read`, the Viewer rank included (answer 22); writes
 * need `usecase:write` and Plan's `requirements` option.
 */
export class UseCaseController {
  protected readonly useCases = $repository(useCases);
  protected readonly quests = $repository(quests);
  protected readonly scenario = $inject(UseCaseService);
  protected readonly requirementService = $inject(RequirementService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly comments = $inject(RequirementsCommentService);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly alepha = $inject(Alepha);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly ranks = $inject(RankService);
  protected readonly templates = $inject(LoreInboxNotifications);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly bound = $inject(BoundParameters);

  /**
   * ⚠️ `$sequence` keys its counter on this PROPERTY NAME.
   */
  protected useCaseNumber = $sequence();

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId" });

  protected ownsProjectForWrite = (requires: string) =>
    $ownsProject({
      requires,
      param: "projectId",
      capability: {
        key: "plan",
        option: "requirements",
        action: "write a use case",
      },
    });

  protected ownsUseCaseForWrite = (requires: string) =>
    $ownsProject({
      requires,
      repository: () => this.useCases,
      param: "id",
      capability: {
        key: "plan",
        option: "requirements",
        action: "write a use case",
      },
    });

  protected async log(
    action: string,
    useCase: Pick<UseCase, "number" | "title" | "projectId">,
    user: UserAccountToken | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.usecase.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(useCase.projectId),
      resourceType: "usecase",
      resourceId: String(useCase.number),
      description: useCase.title,
      ...(metadata ? { metadata } : {}),
    });
  }

  getUseCases = $action({
    method: "GET",
    path: "/getUseCases/:projectId",
    use: [this.ownsProject("usecase:read")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ status: useCaseStatusSchema.optional() }),
      response: z.array(useCaseResourceSchema),
    },
    handler: async ({ params, query }) => {
      const rows = await this.useCases.findMany({
        where: {
          projectId: { eq: params.projectId },
          ...(query.status ? { status: { eq: query.status } } : {}),
        },
        orderBy: [{ column: "number", direction: "asc" }],
      });
      return await this.scenario.toResources(rows);
    },
  });

  getUseCaseByNumber = $action({
    method: "GET",
    path: "/getUseCase/:projectId/:number",
    use: [this.ownsProject("usecase:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: useCaseResourceSchema,
    },
    handler: async ({ params }) => {
      const row = await this.byNumber(params.projectId, params.number);
      const [resource] = await this.scenario.toResources([row]);
      return resource;
    },
  });

  createUseCase = $action({
    method: "POST",
    path: "/createUseCase/:projectId",
    use: [this.ownsProjectForWrite("usecase:write")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: useCaseInputSchema.required({ title: true }),
      response: useCaseResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { actors, steps, alternatives, criteria, ...fields } = body;
      const number = await this.useCaseNumber.next(String(params.projectId));
      // A new use case is a draft: validation is its own act.
      const created = await this.useCases.create({
        ...fields,
        status:
          fields.status && fields.status !== "validated"
            ? fields.status
            : "draft",
        projectId: params.projectId,
        number,
      });
      const row = await this.scenario.writeScenario(
        created,
        { actors, steps, alternatives, criteria },
        { created: true },
      );
      await this.log("create", row, user);
      const [resource] = await this.scenario.toResources([row]);
      return resource;
    },
  });

  updateUseCase = $action({
    method: "POST",
    path: "/updateUseCase/:id",
    use: [this.ownsUseCaseForWrite("usecase:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: useCaseInputSchema,
      response: useCaseResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { actors, steps, alternatives, criteria, ...fields } = body;
      if (fields.status === "validated") {
        throw new BadRequestError(
          "A use case is validated by a holder of usecase:validate, through its validation",
        );
      }
      const current = this.owned.get<UseCase>();
      const updated = Object.keys(fields).length
        ? await this.useCases.updateById(params.id, fields)
        : current;
      const row = await this.scenario.writeScenario(updated, {
        actors,
        steps,
        alternatives,
        criteria,
      });
      await this.log("update", row, user);
      const [resource] = await this.scenario.toResources([row]);
      return resource;
    },
  });

  deleteUseCase = $action({
    method: "POST",
    path: "/deleteUseCase/:id",
    use: [this.ownsUseCaseForWrite("usecase:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const useCase = this.owned.get<UseCase>();
      await this.useCases.deleteById(params.id);
      await this.bestEffort.run(
        "deleteUseCase: mirrors and comments",
        async () => {
          await this.links.deleteMirrorsTo("usecase", [useCase.id]);
          await this.comments.deleteOf("usecase", useCase.id);
        },
      );
      await this.log("delete", useCase, user);
      return { ok: true };
    },
  });

  /**
   * An epic covers this use case, or stops covering it: a `covers` row of
   * the link graph, the edge's only store.
   */
  linkUseCaseEpic = $action({
    method: "POST",
    path: "/linkUseCaseEpic/:id",
    use: [this.ownsUseCaseForWrite("usecase:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        epicNumber: z.integer(),
        linked: z.boolean(),
      }),
      response: useCaseResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const useCase = this.owned.get<UseCase>();
      const ids = await this.resources
        .get("epic")
        ?.resolveNumbers?.(useCase.projectId, [body.epicNumber]);
      const epicId = ids?.get(body.epicNumber);
      if (!epicId) {
        throw new NotFoundError(`Epic #E${body.epicNumber} not found`);
      }
      await this.links.setRelation(
        "covers",
        { kind: "epic", id: epicId },
        { kind: "usecase", id: String(useCase.id) },
        body.linked,
      );
      // A requirement this use case verifies may now pull the epic into its
      // by-hand release, or be cleared by the epic's own (#Q3768).
      await this.bestEffort.run(
        "linkUseCaseEpic: requirement releases",
        async () =>
          this.requirementService.reconcile(
            await this.requirementService.requirementIdsOfUseCases([
              useCase.id,
            ]),
          ),
      );
      await this.log(body.linked ? "cover" : "uncover", useCase, user, {
        epic: body.epicNumber,
      });
      const [resource] = await this.scenario.toResources([useCase]);
      return resource;
    },
  });

  /**
   * Ask for this use case to be validated: every member holding
   * `usecase:validate` gets an inbox message (the owner and the Admins by
   * default). Anyone who writes use cases may ask.
   */
  requestUseCaseValidation = $action({
    method: "POST",
    path: "/requestUseCaseValidation/:id",
    use: [this.ownsUseCaseForWrite("usecase:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.object({ notified: z.integer() }),
    },
    handler: async ({ params, user }) => {
      const useCase = this.owned.get<UseCase>();
      const project = this.owned.authority<Project>();
      await this.useCases.updateById(params.id, {
        validationRequestedAt: this.dt.nowISOString(),
      });
      await this.log("validate", useCase, user, { request: true });
      const notified =
        (await this.bestEffort.run("requestUseCaseValidation: notify", () =>
          this.notifyValidators(project, useCase, user),
        )) ?? 0;
      return { notified };
    },
  });

  /**
   * Answer a validation: Validated sets the use case's status to
   * validated; Changes requested sends it back to draft. The note is kept
   * on the use case and in its Activity. Held by `usecase:validate`, the
   * owner's and the Admin's by default (not "owner only").
   */
  validateUseCase = $action({
    method: "POST",
    path: "/validateUseCase/:id",
    use: [this.ownsUseCaseForWrite("usecase:validate")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        decision: z.enum(["validated", "changes_requested"]),
        note: z.string().max(2000).optional(),
      }),
      response: useCaseResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const useCase = this.owned.get<UseCase>();
      if (useCase.status === "deprecated") {
        throw new BadRequestError("A deprecated use case is not validated");
      }
      const row = await this.useCases.updateById(params.id, {
        status: body.decision === "validated" ? "validated" : "draft",
        validationNote: body.note ?? "",
        validationRequestedAt: null as never,
      });
      await this.log("validate", row, user, {
        decision: body.decision,
        ...(body.note ? { note: body.note } : {}),
      });
      const [resource] = await this.scenario.toResources([row]);
      return resource;
    },
  });

  /**
   * One inbox message per member who may validate, the requester aside.
   */
  protected async notifyValidators(
    project: Project,
    useCase: UseCase,
    requester: UserAccountToken,
  ): Promise<number> {
    const roster = await this.roster.of(useCase.projectId);
    const requesterName =
      roster.find((it) => it.userId === requester.id)?.name || "Someone";
    const slug = project.slug || `project-${project.id}`;
    const href = `/${slug}/requirements/use-cases/${useCase.number}`;
    const baseUrl = String(this.alepha.env.PUBLIC_URL ?? "");
    // `holdersOf`, never `can` per member: `can` answers from the CURRENT
    // request's rank, which is the requester's.
    const holders = new Set(
      await this.ranks.holdersOf(project.organizationId!, "usecase:validate"),
    );
    let notified = 0;
    for (const member of roster) {
      if (member.userId === requester.id || !member.email) continue;
      if (!holders.has(member.userId)) continue;
      await this.templates.inboxUseCaseValidation.push({
        contact: member.email,
        lang: this.templates.lang,
        variables: {
          reference: formatReference("usecase", useCase.number),
          useCaseTitle: useCase.title,
          requesterName,
          projectTitle: project.title,
          href,
          url: `${baseUrl}${href}`,
          scope: `project:${useCase.projectId}`,
        },
      });
      notified++;
    }
    return notified;
  }

  /**
   * Development coverage: the quests of the epics covering this use case,
   * each with its epic and whether it is done. A run's error rule reads the
   * same thing (#Q3770): a failure is expected while one is open.
   */
  getUseCaseCoverage = $action({
    method: "GET",
    path: "/getUseCaseCoverage/:projectId/:number",
    use: [this.ownsProject("usecase:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: z.array(
        z.object({
          shortId: z.integer(),
          title: z.string(),
          epicNumber: z.integer(),
          acceptedAt: z.datetime().optional(),
          completedAt: z.datetime().optional(),
        }),
      ),
    },
    handler: async ({ params }) => {
      const row = await this.byNumber(params.projectId, params.number);
      const covered =
        (await this.scenario.coveringEpics(params.projectId, [row.id])).get(
          row.id,
        ) ?? [];
      if (covered.length === 0) return [];
      const numberOf = new Map(covered.map((epic) => [epic.id, epic.number]));
      // Batched under D1's bind limit (#Q3959), then sorted whole.
      const rows = (
        await this.bound.collect(
          covered.map((epic) => epic.id),
          (batch) =>
            this.quests.findMany({
              where: {
                projectId: { eq: params.projectId },
                epicId: { inArray: batch },
                shelvedAt: { isNull: true },
              },
            }),
        )
      ).sort((a, b) => a.shortId - b.shortId);
      return rows.map((quest) => ({
        shortId: quest.shortId,
        title: quest.title,
        epicNumber: numberOf.get(quest.epicId ?? 0) ?? 0,
        acceptedAt: quest.acceptedAt,
        completedAt: quest.completedAt,
      }));
    },
  });

  getUseCaseComments = $action({
    method: "GET",
    path: "/getUseCaseComments/:projectId/:number",
    use: [this.ownsProject("usecase:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: z.array(requirementsCommentResourceSchema),
    },
    handler: async ({ params }) => {
      const row = await this.byNumber(params.projectId, params.number);
      return await this.comments.list("usecase", row.id);
    },
  });

  addUseCaseComment = $action({
    method: "POST",
    path: "/addUseCaseComment/:id",
    use: [this.ownsUseCaseForWrite("usecase:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
        agentClient: z.text().optional(),
        agent: z.boolean().optional(),
      }),
      response: requirementsCommentResourceSchema,
    },
    handler: async ({ body, user }) => {
      const useCase = this.owned.get<UseCase>();
      const project = this.owned.authority<Project>();
      const slug = project.slug || `project-${project.id}`;
      const comment = await this.comments.add({
        projectId: useCase.projectId,
        subjectKind: "usecase",
        subjectId: useCase.id,
        body: body.body,
        user,
        subject: {
          projectId: useCase.projectId,
          projectTitle: project.title,
          reference: formatReference("usecase", useCase.number),
          title: useCase.title,
          href: `/${slug}/requirements/use-cases/${useCase.number}`,
        },
        agent: body.agent ? { client: body.agentClient } : undefined,
      });
      await this.log("comment", useCase, user);
      return comment;
    },
  });

  /**
   * A live use case of the project by its number, or a 404.
   */
  public async byNumber(projectId: number, number: number): Promise<UseCase> {
    const [row] = await this.useCases.findMany({
      where: { projectId: { eq: projectId }, number: { eq: number } },
      limit: 1,
    });
    if (!row) {
      throw new NotFoundError(`Use case #U${number} not found`);
    }
    return row;
  }
}
