import {
  DashboardMetricRegistry,
  type DashboardResolvable,
  type ResolvedDashboardScope,
} from "@lore/core/api";
import type { DashboardCardValue } from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { personas } from "../entities/personas.ts";
import { requirements } from "../entities/requirements.ts";
import { requirementsCoverageDays } from "../entities/requirementsCoverageDays.ts";
import { useCases } from "../entities/useCases.ts";
import { readinessOf, requirementsOfRelease } from "../requirementReadiness.ts";
import type { RequirementResource } from "../schemas/requirementResourceSchema.ts";
import type { UseCaseResource } from "../schemas/useCaseResourceSchema.ts";
import { PersonaInsightService } from "./PersonaInsightService.ts";
import { RequirementService } from "./RequirementService.ts";
import { UseCaseService } from "./UseCaseService.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;

/**
 * The resolvers of the Requirements cards (#E153, #Q3775), one per metric
 * of `RequirementsDashboardMetrics`, registered on core's
 * `DashboardMetricRegistry`. Each reads what the Requirements page reads
 * (the stored statuses, the stored metric values, the daily snapshot), so a
 * board never sends one analytics query per requirement.
 */
export class RequirementsMetricResolvers {
  protected readonly dashboard = $inject(DashboardMetricRegistry);
  protected readonly requirements = $repository(requirements);
  protected readonly useCases = $repository(useCases);
  protected readonly personas = $repository(personas);
  protected readonly days = $repository(requirementsCoverageDays);
  protected readonly requirementService = $inject(RequirementService);
  protected readonly useCaseService = $inject(UseCaseService);
  protected readonly insights = $inject(PersonaInsightService);
  protected readonly dt = $inject(DateTimeProvider);

  protected static readonly PRIORITY_ORDER = {
    must: 0,
    should: 1,
    could: 2,
    wont: 3,
  } as const;

  constructor() {
    const each =
      (
        resolve: (
          entry: DashboardResolvable,
          projectId: number,
          slug: string,
        ) => Promise<CardValue>,
      ) =>
      async (cards: DashboardResolvable[]) => {
        const out = new Map<number, CardValue>();
        for (const entry of cards) {
          const project = entry.scope.projects[0];
          if (!project) {
            out.set(entry.card.id, { empty: "noData", detail: {} });
            continue;
          }
          out.set(
            entry.card.id,
            await resolve(entry, project.id, project.slug ?? ""),
          );
        }
        return out;
      };
    this.dashboard.register({
      metric: "requirementCoverage",
      resolveAll: each((entry, projectId, slug) =>
        this.coverage(entry.scope, projectId, slug),
      ),
    });
    this.dashboard.register({
      metric: "releaseReadiness",
      resolveAll: each((entry, projectId, slug) =>
        this.readiness(entry.scope, projectId, slug),
      ),
    });
    this.dashboard.register({
      metric: "useCaseHealth",
      resolveAll: each((_entry, projectId, slug) =>
        this.useCaseHealth(projectId, slug),
      ),
    });
    this.dashboard.register({
      metric: "requirementsToCover",
      resolveAll: each((entry, projectId, slug) =>
        this.toCover(entry.scope, projectId, slug),
      ),
    });
    this.dashboard.register({
      metric: "personaHealth",
      resolveAll: each((_entry, projectId, slug) =>
        this.personaHealth(projectId, slug),
      ),
    });
    this.dashboard.register({
      metric: "requirementCoverageTrend",
      resolveAll: each((entry, projectId) =>
        this.trend(entry.scope, projectId),
      ),
    });
  }

  protected releaseIdOf(scope: ResolvedDashboardScope): number | undefined {
    const row = scope.subjects.find((it) => it.kind === "release")?.row as
      | { id: number }
      | undefined;
    return row?.id;
  }

  protected async requirementRows(
    projectId: number,
    releaseId?: number,
  ): Promise<RequirementResource[]> {
    return requirementsOfRelease(
      await this.requirementService.toResources(
        await this.requirements.findMany({
          where: { projectId: { eq: projectId } },
          orderBy: [{ column: "number", direction: "asc" }],
        }),
      ),
      releaseId,
    );
  }

  protected async useCaseRows(projectId: number): Promise<UseCaseResource[]> {
    const rows = await this.useCases.findMany({
      where: {
        projectId: { eq: projectId },
        status: { ne: "deprecated" },
      },
    });
    return await this.useCaseService.toResources(rows);
  }

  /**
   * Where a requirement stands for the coverage card: verified, failing,
   * development planned (an epic covers it, its quests open), specified
   * without development (a use case, no epic), not covered.
   */
  public bucketOf(
    it: Pick<RequirementResource, "status" | "coveringEpics">,
  ): "verified" | "failing" | "devPlanned" | "specified" | "notCovered" {
    if (it.status === "verified") return "verified";
    if (it.status === "failing") return "failing";
    if (it.status === "not_covered") return "notCovered";
    return it.coveringEpics.length ? "devPlanned" : "specified";
  }

  protected async coverage(
    scope: ResolvedDashboardScope,
    projectId: number,
    slug: string,
  ): Promise<CardValue> {
    const rows = await this.requirementRows(projectId, this.releaseIdOf(scope));
    if (rows.length === 0) return { empty: "noData", detail: {} };
    const count = (bucket: ReturnType<typeof this.bucketOf>) =>
      rows.filter((it) => this.bucketOf(it) === bucket).length;
    const verified = count("verified");
    return {
      value: Math.round((verified / rows.length) * 100),
      detail: { verified, total: rows.length },
      segments: [
        { label: "verified", value: verified, state: "ok" },
        { label: "failing", value: count("failing"), state: "bad" },
        { label: "devPlanned", value: count("devPlanned"), state: "accent" },
        { label: "specified", value: count("specified"), state: "warn" },
        { label: "notCovered", value: count("notCovered"), state: "neutral" },
      ],
      link: { route: "projectRequirements", params: { projectSlug: slug } },
    };
  }

  protected async readiness(
    scope: ResolvedDashboardScope,
    projectId: number,
    slug: string,
  ): Promise<CardValue> {
    const releaseId = this.releaseIdOf(scope);
    if (releaseId === undefined) {
      return { empty: "noRelease", detail: { hidden: true } };
    }
    const readiness = readinessOf(
      await this.requirementRows(projectId, releaseId),
    );
    if (readiness.must.total + readiness.should.total === 0) {
      return { empty: "noData", detail: {} };
    }
    const failing = readiness.failingMust.length;
    return {
      ...(readiness.must.total
        ? {
            value: Math.round(
              (readiness.must.verified / readiness.must.total) * 100,
            ),
          }
        : {}),
      detail: {
        mustVerified: readiness.must.verified,
        mustTotal: readiness.must.total,
        shouldVerified: readiness.should.verified,
        shouldTotal: readiness.should.total,
        failing: readiness.failingMust
          .map((it) => formatReference("requirement", it.number))
          .join(", "),
      },
      segments: [
        { label: "verified", value: readiness.must.verified, state: "ok" },
        { label: "failing", value: failing, state: "bad" },
        {
          label: "todo",
          value: Math.max(
            0,
            readiness.must.total - readiness.must.verified - failing,
          ),
          state: "neutral",
        },
      ],
      link: { route: "projectRequirements", params: { projectSlug: slug } },
    };
  }

  protected async useCaseHealth(
    projectId: number,
    slug: string,
  ): Promise<CardValue> {
    const rows = await this.useCaseRows(projectId);
    if (rows.length === 0) return { empty: "noData", detail: {} };
    const count = (state: UseCaseResource["state"]) =>
      rows.filter((it) => it.state === state).length;
    const passed = count("passed");
    return {
      value: Math.round((passed / rows.length) * 100),
      detail: {
        passed,
        total: rows.length,
        stale: rows.filter((it) => it.stale).length,
      },
      segments: [
        { label: "passed", value: passed, state: "ok" },
        { label: "failed", value: count("failed"), state: "bad" },
        {
          label: "inDevelopment",
          value: count("in_development"),
          state: "accent",
        },
        { label: "neverRun", value: count("never_run"), state: "neutral" },
      ],
      link: { route: "projectUseCases", params: { projectSlug: slug } },
    };
  }

  protected async toCover(
    scope: ResolvedDashboardScope,
    projectId: number,
    slug: string,
  ): Promise<CardValue> {
    const rows = (
      await this.requirementRows(projectId, this.releaseIdOf(scope))
    )
      .filter((it) => it.status !== "verified")
      .sort(
        (a, b) =>
          RequirementsMetricResolvers.PRIORITY_ORDER[a.priority] -
            RequirementsMetricResolvers.PRIORITY_ORDER[b.priority] ||
          a.number - b.number,
      );
    return {
      value: rows.length,
      detail: {},
      rows: rows.slice(0, 10).map((it) => ({
        id: `S${it.number}`,
        title: `${formatReference("requirement", it.number)} ${it.statement}`,
        badge: it.priority,
        state:
          it.status === "failing"
            ? ("bad" as const)
            : it.priority === "must"
              ? ("warn" as const)
              : ("neutral" as const),
        link: {
          route: "projectRequirements",
          params: { projectSlug: slug },
          query: { requirement: String(it.number) },
        },
      })),
      link: { route: "projectRequirements", params: { projectSlug: slug } },
    };
  }

  protected async personaHealth(
    projectId: number,
    slug: string,
  ): Promise<CardValue> {
    const people = await this.personas.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "number", direction: "asc" }],
    });
    if (people.length === 0) return { empty: "noData", detail: {} };
    const cases = await this.useCaseRows(projectId);
    const rows = [];
    for (const persona of people.slice(0, 12)) {
      const theirs = cases.filter((it) =>
        it.actors.some((a) => a.personaId === persona.id),
      );
      const passed = theirs.filter((it) => it.state === "passed").length;
      const changed = (await this.insights.changesOf(persona)).changes.length;
      rows.push({
        id: `A${persona.number}`,
        title: `${formatReference("persona", persona.number)} ${persona.name}`,
        meta: `${passed}/${theirs.length}`,
        ...(theirs.length
          ? { progress: Math.round((passed / theirs.length) * 100) }
          : {}),
        ...(changed ? { badge: "scopeChanged", state: "warn" as const } : {}),
        link: {
          route: "projectPersona",
          params: { projectSlug: slug, personaNumber: String(persona.number) },
        },
      });
    }
    return {
      value: people.length,
      detail: {},
      rows,
      link: { route: "projectPersonas", params: { projectSlug: slug } },
    };
  }

  protected async trend(
    scope: ResolvedDashboardScope,
    projectId: number,
  ): Promise<CardValue> {
    const releaseId = this.releaseIdOf(scope);
    const since = this.dt.now().subtract(30, "day").toISOString().slice(0, 10);
    const rows = await this.days.findMany({
      where: {
        projectId: { eq: projectId },
        scope: { eq: releaseId ? `release:${releaseId}` : "all" },
        day: { gte: since },
      },
      orderBy: [{ column: "day", direction: "asc" }],
    });
    const points = rows.filter((it) => it.total > 0);
    if (points.length === 0) return { empty: "noData", detail: {} };
    const share = (part: number, total: number) =>
      Math.round((part / total) * 100);
    const last = points[points.length - 1];
    return {
      value: share(last.verified, last.total),
      unit: "percent",
      detail: { covered: share(last.covered, last.total) },
      series: points.map((it) => ({
        at: it.day,
        value: share(it.verified, it.total),
      })),
    };
  }
}
