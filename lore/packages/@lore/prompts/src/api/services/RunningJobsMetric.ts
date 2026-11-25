import {
  type DashboardMetricResolver,
  DashboardMetricRegistry,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
  hostJobs,
  hosts,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { AgentJobProjectEvents } from "./AgentJobProjectEvents.ts";

type Resolved = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;

/**
 * The Running jobs card (#Q4342): the project's agent jobs queued or
 * running, the running ones first, then oldest first, so the run that has
 * gone longest heads the list. Each row is the run as a person says it
 * ("Work on epic #E175 ..."), its host, and since when it runs (or waits),
 * linking to the job's page. The headline counts the running ones; with
 * none queued or running the card answers `noJobs`, so a board shows it
 * only while something runs.
 *
 * A capability check is a host job too, but nobody waits on one: only
 * agent jobs are listed.
 */
export class RunningJobsMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "runningJobs";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly titles = $inject(AgentJobProjectEvents);
  protected readonly jobs = $repository(hostJobs);
  protected readonly hosts = $repository(hosts);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<Map<number, Resolved>> {
    const out = new Map<number, Resolved>();
    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const slug = project.slug ?? "";
      const rows = await this.jobs.findMany({
        where: {
          projectId: { eq: project.id },
          kind: { eq: "agent" },
          status: { inArray: ["queued", "running"] },
        },
        orderBy: [{ column: "queuedAt", direction: "asc" }],
        limit: 50,
      });
      if (rows.length === 0) {
        out.set(entry.card.id, { empty: "noJobs", detail: {} });
        continue;
      }
      const hostIds = [...new Set(rows.map((row) => row.hostId))];
      const hostList = hostIds.length
        ? await this.hosts.findMany({
            where: { id: { inArray: hostIds } },
            columns: ["id", "slug"],
          })
        : [];
      const running = rows.filter((row) => row.status === "running");
      const ordered = [
        ...running,
        ...rows.filter((row) => row.status !== "running"),
      ];
      const listed = await Promise.all(
        ordered.map(async (row) => ({
          id: hostList.find((host) => host.id === row.hostId)?.slug,
          title: await this.titles.titleOf({
            projectId: row.projectId,
            prompt: row.prompt ?? undefined,
            args: row.args ?? undefined,
            subjectType: row.subjectType ?? undefined,
          }),
          badge: row.status,
          state:
            row.status === "running"
              ? ("accent" as const)
              : ("neutral" as const),
          at: row.startedAt ?? row.queuedAt,
          ...(slug
            ? {
                link: {
                  route: "projectJob",
                  params: { projectSlug: slug, jobId: row.id },
                },
              }
            : {}),
        })),
      );
      out.set(entry.card.id, {
        value: running.length,
        rows: listed.map(({ id, ...row }) => (id ? { id, ...row } : row)),
        detail: { jobs: listed.length },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }
}
