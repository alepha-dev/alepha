import {
  $ownsProject,
  BestEffort,
  LoreAudits,
  ResourceLinkService,
} from "@lore/core/api";
import { releases } from "@lore/plan/schemas";
import { folioRevisions, folios } from "@lore/remember/schemas";
import { $inject, z } from "alepha";
import { $repository, $sequence } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { type Requirement, requirements } from "../entities/requirements.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import { releaseMoveSchema } from "../schemas/releaseMoveSchema.ts";
import { requirementInputSchema } from "../schemas/requirementInputSchema.ts";
import { requirementPrioritySchema } from "../schemas/requirementPrioritySchema.ts";
import { requirementResourceSchema } from "../schemas/requirementResourceSchema.ts";
import { requirementTypeSchema } from "../schemas/requirementTypeSchema.ts";
import { RequirementMetricService } from "../services/RequirementMetricService.ts";
import { RequirementService } from "../services/RequirementService.ts";
import { SourceSectionService } from "../services/SourceSectionService.ts";

/**
 * Requirements (#E153): the specification's lines, their criteria and their
 * target release. Reads need `requirement:read`, the Viewer rank included;
 * writes need `requirement:write` and Plan's `requirements` option.
 */
export class RequirementController {
  protected readonly requirements = $repository(requirements);
  protected readonly criteria = $repository(useCaseCriteria);
  protected readonly useCases = $repository(useCases);
  protected readonly service = $inject(RequirementService);
  protected readonly metrics = $inject(RequirementMetricService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly sections = $inject(SourceSectionService);
  protected readonly folios = $repository(folios);
  protected readonly revisions = $repository(folioRevisions);
  protected readonly releases = $repository(releases);

  /**
   * ⚠️ `$sequence` keys its counter on this PROPERTY NAME.
   */
  protected requirementNumber = $sequence();

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId" });

  protected ownsProjectForWrite = (requires: string) =>
    $ownsProject({
      requires,
      param: "projectId",
      capability: {
        key: "plan",
        option: "requirements",
        action: "write a requirement",
      },
    });

  protected ownsRequirementForWrite = (requires: string) =>
    $ownsProject({
      requires,
      repository: () => this.requirements,
      param: "id",
      capability: {
        key: "plan",
        option: "requirements",
        action: "write a requirement",
      },
    });

  protected async log(
    action: string,
    row: Pick<Requirement, "number" | "statement" | "projectId">,
    user: UserAccountToken | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.requirement.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(row.projectId),
      resourceType: "requirement",
      resourceId: String(row.number),
      description: row.statement,
      ...(metadata ? { metadata } : {}),
    });
  }

  /**
   * The `source` mirror row of one requirement, rewritten from its columns.
   */
  /**
   * The source columns a write sets: the cited section's text and the
   * folio's newest revision, so later revisions compare with them. No
   * source, or a protected folio, syncs nothing.
   */
  protected async syncedSource(fields: {
    sourceFolioId?: string;
    sourceAnchor?: string;
  }): Promise<Partial<Requirement>> {
    if (!fields.sourceFolioId) return {};
    const folio = await this.folios.findById(fields.sourceFolioId);
    if (!folio || folio.protected) return {};
    const [head] = await this.revisions.findMany({
      where: { folioId: { eq: folio.id } },
      orderBy: [{ column: "at", direction: "desc" }],
      columns: ["id"],
      limit: 1,
    });
    const section = fields.sourceAnchor
      ? this.sections.section(folio.content ?? "", fields.sourceAnchor)
      : undefined;
    return {
      sourceRevisionId: head?.id,
      sourceSectionText:
        section?.text ?? (fields.sourceAnchor ? "" : undefined),
      sourceChanged: false,
      sourceChangeKind: null as never,
      sourceChangedRevisionId: null as never,
    };
  }

  protected async mirrorSource(row: Requirement): Promise<void> {
    await this.bestEffort.run("requirement: source mirror", () =>
      this.links.mirrorOutbound(
        "source",
        { kind: "requirement", id: row.id },
        "folio",
        row.sourceFolioId ? [row.sourceFolioId] : [],
      ),
    );
  }

  getRequirements = $action({
    method: "GET",
    path: "/getRequirements/:projectId",
    use: [this.ownsProject("requirement:read")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        type: requirementTypeSchema.optional(),
        priority: requirementPrioritySchema.optional(),
      }),
      response: z.array(requirementResourceSchema),
    },
    handler: async ({ params, query }) => {
      const rows = await this.requirements.findMany({
        where: {
          projectId: { eq: params.projectId },
          ...(query.type ? { type: { eq: query.type } } : {}),
          ...(query.priority ? { priority: { eq: query.priority } } : {}),
        },
        orderBy: [{ column: "number", direction: "asc" }],
      });
      return await this.service.toResources(rows);
    },
  });

  getRequirementByNumber = $action({
    method: "GET",
    path: "/getRequirement/:projectId/:number",
    use: [this.ownsProject("requirement:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: requirementResourceSchema,
    },
    handler: async ({ params }) => {
      const [resource] = await this.service.toResources([
        await this.byNumber(params.projectId, params.number),
      ]);
      return resource;
    },
  });

  createRequirement = $action({
    method: "POST",
    path: "/createRequirement/:projectId",
    use: [this.ownsProjectForWrite("requirement:write")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: requirementInputSchema.required({ statement: true }).extend({
        targetReleaseId: z.integer().optional(),
      }),
      response: requirementResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const number = await this.requirementNumber.next(
        String(params.projectId),
      );
      const { metric, ...fields } = body;
      let row = await this.requirements.create({
        ...fields,
        ...(metric ? { metric } : {}),
        ...(await this.syncedSource(body)),
        projectId: params.projectId,
        number,
      });
      // Saving a metric evaluates it at once (#Q3773).
      if (row.metric) row = await this.metrics.evaluateOne(row);
      await this.mirrorSource(row);
      await this.log("create", row, user);
      const [resource] = await this.service.toResources([row]);
      return resource;
    },
  });

  updateRequirement = $action({
    method: "POST",
    path: "/updateRequirement/:id",
    use: [this.ownsRequirementForWrite("requirement:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: requirementInputSchema,
      response: requirementResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const before = this.owned.get<Requirement>();
      const sourceMoved =
        (body.sourceFolioId !== undefined &&
          body.sourceFolioId !== before.sourceFolioId) ||
        (body.sourceAnchor !== undefined &&
          body.sourceAnchor !== before.sourceAnchor);
      const { metric, ...fields } = body;
      let row = await this.requirements.updateById(params.id, {
        ...fields,
        ...(metric === null
          ? {
              metric: null,
              metricValue: null,
              metricStatus: null,
              metricStatusSince: null,
              metricEvaluatedAt: null,
            }
          : metric
            ? { metric }
            : {}),
        ...(sourceMoved
          ? await this.syncedSource({
              sourceFolioId: body.sourceFolioId ?? before.sourceFolioId,
              sourceAnchor: body.sourceAnchor ?? before.sourceAnchor,
            })
          : {}),
      } as never);
      if (metric) row = await this.metrics.evaluateOne(row);
      await this.mirrorSource(row);
      await this.log("update", row, user);
      const [resource] = await this.service.toResources([row]);
      return resource;
    },
  });

  /**
   * A soft delete: the number is never reused. The criteria that verified it
   * verify nothing afterwards.
   */
  deleteRequirement = $action({
    method: "POST",
    path: "/deleteRequirement/:id",
    use: [this.ownsRequirementForWrite("requirement:write")],
    schema: { params: z.object({ id: z.integer() }), response: okSchema },
    handler: async ({ params, user }) => {
      const row = this.owned.get<Requirement>();
      await this.requirements.deleteById(params.id);
      await this.bestEffort.run(
        "deleteRequirement: criteria and mirror",
        async () => {
          await this.criteria.updateMany(
            { requirementId: { eq: row.id } },
            { requirementId: null as never },
          );
          await this.links.deleteLinksFrom({ kind: "requirement", id: row.id });
        },
      );
      await this.log("delete", row, user);
      return { ok: true };
    },
  });

  /**
   * Update the requirement or Keep it, after its source changed: either way
   * the synced section and revision move to the folio's newest, and the flag
   * clears.
   */
  resyncRequirementSource = $action({
    method: "POST",
    path: "/resyncRequirementSource/:id",
    use: [this.ownsRequirementForWrite("requirement:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      response: requirementResourceSchema,
    },
    handler: async ({ params, user }) => {
      const row = this.owned.get<Requirement>();
      const saved = await this.requirements.updateById(params.id, {
        ...(await this.syncedSource(row)),
        sourceChanged: false,
        sourceChangeKind: null as never,
        sourceChangedRevisionId: null as never,
      });
      await this.log("update", saved, user, { source: "resync" });
      const [resource] = await this.service.toResources([saved]);
      return resource;
    },
  });

  /**
   * The project's releases, for the Release filter and the Target release
   * selector: a reader of requirements may pick one without `release:read`'s
   * whole surface.
   */
  getRequirementReleases = $action({
    method: "GET",
    path: "/getRequirementReleases/:projectId",
    use: [this.ownsProject("requirement:read")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.array(
        z.object({
          id: z.integer(),
          number: z.integer(),
          tag: z.string().optional(),
          title: z.string().optional(),
        }),
      ),
    },
    handler: async ({ params }) =>
      (
        await this.releases.findMany({
          where: { projectId: { eq: params.projectId } },
          columns: ["id", "number", "tag", "title"],
          orderBy: [{ column: "number", direction: "desc" }],
        })
      ).map((it) => ({
        id: it.id,
        number: it.number,
        tag: it.tag ?? undefined,
        title: it.title ?? undefined,
      })),
  });

  /**
   * Set the target release. Uncovered (no covering epic): stored by hand.
   * Covered: every covering epic moves to it, and the stored value goes;
   * when one of them covers other requirements or already sits in another
   * release, nothing changes and the moves come back until `confirm`.
   * `null` clears a by-hand release.
   */
  setRequirementRelease = $action({
    method: "POST",
    path: "/setRequirementRelease/:id",
    use: [this.ownsRequirementForWrite("requirement:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        releaseId: z.integer().nullable(),
        confirm: z.boolean().optional(),
      }),
      response: z.object({
        applied: z.boolean(),
        moves: z.array(releaseMoveSchema),
        requirement: requirementResourceSchema,
      }),
    },
    handler: async ({ params, body, user }) => {
      const row = this.owned.get<Requirement>();
      const [resource] = await this.service.toResources([row]);
      if (resource.coveringEpics.length === 0 || body.releaseId === null) {
        if (
          body.releaseId === null &&
          resource.coveringEpics.some((it) => it.releaseId)
        ) {
          throw new BadRequestError(
            "This requirement's release comes from its covering epics: move them, or set another release",
          );
        }
        const saved = await this.requirements.updateById(params.id, {
          targetReleaseId: (body.releaseId ?? null) as never,
        });
        await this.log("release", saved, user, { releaseId: body.releaseId });
        const [next] = await this.service.toResources([saved]);
        return { applied: true, moves: [], requirement: next };
      }
      const { moves, ask } = await this.service.movesFor(
        resource,
        body.releaseId,
      );
      if (ask && !body.confirm) {
        return { applied: false, moves, requirement: resource };
      }
      await this.service.moveEpics(
        moves.map((it) => it.epicId),
        body.releaseId,
      );
      const saved = row.targetReleaseId
        ? await this.requirements.updateById(params.id, {
            targetReleaseId: null as never,
          })
        : row;
      await this.log("release", saved, user, {
        releaseId: body.releaseId,
        moved: moves.map((it) => it.epicNumber),
      });
      const [next] = await this.service.toResources([saved]);
      return { applied: true, moves, requirement: next };
    },
  });

  /**
   * Say which requirement a criterion verifies, or none (`null`). Linking a
   * covered criterion may pull the requirement's covering epics into its
   * by-hand release (`RequirementService.reconcile`).
   */
  linkCriterion = $action({
    method: "POST",
    path: "/linkCriterion/:projectId",
    use: [this.ownsProjectForWrite("requirement:write")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        useCaseNumber: z.integer(),
        criterionKey: z.string(),
        requirementNumber: z.integer().nullable(),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const [useCase] = await this.useCases.findMany({
        where: {
          projectId: { eq: params.projectId },
          number: { eq: body.useCaseNumber },
        },
        limit: 1,
      });
      if (!useCase)
        throw new NotFoundError(`Use case #U${body.useCaseNumber} not found`);
      const [criterion] = await this.criteria.findMany({
        where: {
          useCaseId: { eq: useCase.id },
          key: { eq: body.criterionKey.toUpperCase() },
        },
        limit: 1,
      });
      if (!criterion) {
        throw new NotFoundError(
          `Criterion ${body.criterionKey} of #U${body.useCaseNumber} not found`,
        );
      }
      const requirement =
        body.requirementNumber === null
          ? undefined
          : await this.byNumber(params.projectId, body.requirementNumber);
      await this.criteria.updateById(criterion.id, {
        requirementId: (requirement?.id ?? null) as never,
      });
      if (requirement) {
        await this.bestEffort.run("linkCriterion: release", () =>
          this.service.reconcile([requirement.id]),
        );
        await this.log("verify", requirement, user, {
          useCase: useCase.number,
          criterion: criterion.key,
        });
      }
      return { ok: true };
    },
  });

  public async byNumber(
    projectId: number,
    number: number,
  ): Promise<Requirement> {
    const [row] = await this.requirements.findMany({
      where: { projectId: { eq: projectId }, number: { eq: number } },
      limit: 1,
    });
    if (!row) throw new NotFoundError(`Requirement #S${number} not found`);
    return row;
  }
}
