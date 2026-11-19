import {
  BoundParameters,
  ProjectSecurityService,
  ResourceLinkService,
} from "@lore/core/api";
import { epics, quests, releases } from "@lore/plan/schemas";
import { projectErrors } from "@lore/ship/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { personas } from "../entities/personas.ts";
import { type Requirement, requirements } from "../entities/requirements.ts";
import { technicalEpics } from "../entities/technicalEpics.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import {
  readinessOf,
  type RequirementReadiness,
  requirementsOfRelease,
} from "../requirementReadiness.ts";
import type {
  RequirementCoverage,
  RequirementImpact,
} from "../schemas/requirementCoverageSchema.ts";
import type { RequirementResource } from "../schemas/requirementResourceSchema.ts";
import { RequirementService } from "./RequirementService.ts";
import { UseCaseService } from "./UseCaseService.ts";

/**
 * Traceability (#E153, #Q3774): a release's readiness, the coverage gaps,
 * and a requirement's impact chain. Read on demand: the matrix itself is
 * drawn in the browser from the lists it already reads.
 */
export class RequirementCoverageService {
  protected readonly requirements = $repository(requirements);
  protected readonly useCases = $repository(useCases);
  protected readonly criteria = $repository(useCaseCriteria);
  protected readonly personas = $repository(personas);
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);
  protected readonly releases = $repository(releases);
  protected readonly technical = $repository(technicalEpics);
  protected readonly errors = $repository(projectErrors);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly requirementService = $inject(RequirementService);
  protected readonly useCaseService = $inject(UseCaseService);
  protected readonly bound = $inject(BoundParameters);

  protected async resources(projectId: number): Promise<RequirementResource[]> {
    return await this.requirementService.toResources(
      await this.requirements.findMany({
        where: { projectId: { eq: projectId } },
        orderBy: [{ column: "number", direction: "asc" }],
      }),
    );
  }

  /**
   * The requirements of a release (or all), as resources.
   */
  public async rows(
    projectId: number,
    releaseId?: number,
  ): Promise<RequirementResource[]> {
    return requirementsOfRelease(await this.resources(projectId), releaseId);
  }

  /**
   * A release's readiness, or the whole project's without one.
   */
  public async readiness(
    projectId: number,
    releaseId?: number,
  ): Promise<RequirementReadiness> {
    return readinessOf(
      requirementsOfRelease(await this.resources(projectId), releaseId),
    );
  }

  /**
   * Whether the project refuses to publish a release with a failing Must:
   * Plan's `requirements` and `blockFailingMust` options both on.
   */
  public async blocks(projectId: number): Promise<boolean> {
    const plan = (await this.security.capabilitiesOf(projectId)).plan;
    return plan?.requirements === true && plan?.blockFailingMust === true;
  }

  /**
   * Readiness and the four gap lists.
   */
  public async coverage(
    projectId: number,
    releaseId?: number,
  ): Promise<RequirementCoverage> {
    const [all, cases, people, epicRows, marked, linked, release] =
      await Promise.all([
        this.resources(projectId),
        this.useCases.findMany({
          where: { projectId: { eq: projectId } },
          orderBy: [{ column: "number", direction: "asc" }],
        }),
        this.personas.findMany({
          where: { projectId: { eq: projectId } },
          orderBy: [{ column: "number", direction: "asc" }],
        }),
        this.epics.findMany({
          where: {
            projectId: { eq: projectId },
            status: { inArray: ["draft", "ready", "in_progress"] },
          },
          columns: ["id", "number", "title"],
          orderBy: [{ column: "number", direction: "asc" }],
        }),
        this.technical.findMany({ where: { projectId: { eq: projectId } } }),
        this.criteria.findMany({
          where: { requirementId: { isNotNull: true } },
          columns: ["useCaseId"],
        }),
        releaseId
          ? this.releases.findById(releaseId)
          : Promise.resolve(undefined),
      ]);
    const rows = requirementsOfRelease(all, releaseId);
    const readiness = readinessOf(rows);
    const live = cases.filter((it) => it.status !== "deprecated");
    const resources = await this.useCaseService.toResources(live);
    const withRequirement = new Set(linked.map((it) => it.useCaseId));
    const passing = new Set(
      resources
        .filter((it) => it.state === "passed")
        .flatMap((it) => it.actors.map((a) => a.personaId)),
    );
    const covered = new Set(
      (
        await this.links.relationsTo(
          "covers",
          "usecase",
          cases.map((it) => String(it.id)),
        )
      ).map((it) => Number(it.fromId)),
    );
    const technical = new Set(marked.map((it) => it.epicId));
    return {
      release:
        release && release.projectId === projectId
          ? { id: release.id, tag: release.tag, title: release.title }
          : undefined,
      ...readiness,
      blocking:
        readiness.failingMust.length > 0 && (await this.blocks(projectId)),
      gaps: {
        requirementsNotVerified: rows
          .filter((it) => it.status !== "verified")
          .map((it) => ({
            number: it.number,
            statement: it.statement,
            status: it.status,
          })),
        useCasesWithoutRequirement: live
          .filter((it) => !withRequirement.has(it.id))
          .map((it) => ({ number: it.number, title: it.title })),
        personasWithoutPassingUseCase: people
          .filter((it) => !passing.has(it.id))
          .map((it) => ({ number: it.number, name: it.name })),
        epicsWithoutUseCase: epicRows
          .filter((it) => !covered.has(it.id) && !technical.has(it.id))
          .map((it) => ({ id: it.id, number: it.number, title: it.title })),
      },
    };
  }

  /**
   * Mark an epic technical, or unmark it: it leaves the gap list.
   */
  public async setTechnical(
    projectId: number,
    epicId: number,
    technical: boolean,
  ): Promise<void> {
    const [row] = await this.technical.findMany({
      where: { epicId: { eq: epicId } },
      limit: 1,
    });
    if (technical && !row) {
      await this.technical.create({ projectId, epicId });
    } else if (!technical && row) {
      await this.technical.deleteById(row.id);
    }
  }

  /**
   * A requirement's impact chain: its criteria per use case, the epics
   * covering those use cases with their quests and commits, and the errors
   * its criteria opened.
   */
  public async impactOf(row: Requirement): Promise<RequirementImpact> {
    const [resource] = await this.requirementService.toResources([row]);
    const caseNumbers = [
      ...new Set(resource.criteria.map((it) => it.useCaseNumber)),
    ];
    // Batched under D1's bind limit (#Q3959).
    const caseRows = await this.bound.collect(caseNumbers, (batch) =>
      this.useCases.findMany({
        where: {
          projectId: { eq: row.projectId },
          number: { inArray: batch },
        },
      }),
    );
    const caseResources = await this.useCaseService.toResources(caseRows);
    const epicIds = resource.coveringEpics.map((it) => it.id);
    const questRows = (
      await this.bound.collect(epicIds, (batch) =>
        this.quests.findMany({
          where: { epicId: { inArray: batch } },
          columns: [
            "id",
            "shortId",
            "title",
            "completedAt",
            "epicId",
            "commits",
          ],
        }),
      )
    ).sort((a, b) => a.shortId - b.shortId);
    const commits = questRows.flatMap((it) => it.commits ?? []);
    const fingerprints = resource.criteria
      .map((c) => {
        const uc = caseRows.find((it) => it.number === c.useCaseNumber);
        return uc ? `usecase:${uc.id}:${c.key}` : undefined;
      })
      .filter((it): it is string => !!it);
    const errorRows = (
      await this.bound.collect(fingerprints, (batch) =>
        this.errors.findMany({
          where: {
            projectId: { eq: row.projectId },
            fingerprint: { inArray: batch },
          },
        }),
      )
    ).sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
    return {
      useCases: caseResources.map((uc) => ({
        number: uc.number,
        title: uc.title,
        stale: uc.stale,
        criteria: resource.criteria
          .filter((c) => c.useCaseNumber === uc.number)
          .map((c) => ({ key: c.key, result: c.result })),
      })),
      epics: resource.coveringEpics.map((epic) => {
        const mine = questRows.filter((it) => it.epicId === epic.id);
        return {
          number: epic.number,
          title: epic.title,
          done: mine.filter((it) => it.completedAt).length,
          total: mine.length,
        };
      }),
      quests: questRows.map((it) => ({
        number: it.shortId,
        title: it.title,
        completed: !!it.completedAt,
      })),
      commits: {
        count: commits.length,
        last: commits.at(-1)?.sha.slice(0, 7),
      },
      errors: errorRows.map((it) => ({
        id: it.id,
        name: it.name,
        message: it.message,
        status: it.status,
        lastSeenAt: it.lastSeenAt,
      })),
    };
  }
}
