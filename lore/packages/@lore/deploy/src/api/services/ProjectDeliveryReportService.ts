import { DeliveryChangeRegistry, ReportStatistics } from "@lore/core/api";
import type { ReportsDelivery, ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { deployments } from "../entities/deployments.ts";
import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { monitors } from "../entities/monitors.ts";

/**
 * The Delivery tab's report (#Q3008): DORA's four keys, per app and
 * environment.
 *
 * ⚠️ **A rollback has no flag.** `RollbackService` writes an ordinary
 * deployment, so one is told by what it deployed: a tag that instance already
 * ran, when the run before it was another tag. Redeploying the same tag twice,
 * which `latest` does all day, is not one.
 */
export class ProjectDeliveryReportService {
  protected readonly deployments = $repository(deployments);
  protected readonly instances = $repository(appInstances);
  protected readonly artifacts = $repository(artifacts);
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly changes = $inject(DeliveryChangeRegistry);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly dt = $inject(DateTimeProvider);

  async report(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsDelivery> {
    const to = query.to ?? this.dt.nowISOString();
    const from = query.from ?? this.dt.now().subtract(90, "day").toISOString();
    const [rows, instances, built, changes] = await Promise.all([
      // Every run, not the period's: what an instance ran BEFORE the period is
      // what tells a rollback inside it.
      this.deployments.findMany({
        where: { projectId: { eq: projectId } },
        columns: [
          "instanceId",
          "tag",
          "status",
          "artifactId",
          "createdAt",
          "startedAt",
          "finishedAt",
        ],
        orderBy: { column: "createdAt", direction: "asc" },
      }),
      this.instances.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "app", "env"],
      }),
      this.artifacts.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "commitSha"],
      }),
      this.changes.changes(projectId, { from, to }),
    ]);

    const inPeriod = (at: string) => at >= from && at <= to;
    const rollbacks = this.rollbacks(rows);
    const finished = rows.filter(
      (row) =>
        inPeriod(row.createdAt) &&
        (row.status === "succeeded" || row.status === "failed"),
    );
    const failed = finished.filter((row) => row.status === "failed");
    const succeeded = finished.filter((row) => row.status === "succeeded");
    const rolledBack = succeeded.filter((row) => rollbacks.has(row)).length;
    const weeks = Math.max(this.stats.between(from, to).length / 7, 1 / 7);

    const lead = this.leadTimes(rows, built, changes);
    const restore = await this.restoreMinutes(projectId, from, to);
    const nameOf = new Map(instances.map((row) => [row.id, row]));

    return {
      deploysPerWeek: succeeded.length / weeks,
      lead: {
        measured: lead.hours.length,
        unmatched: lead.unmatched,
        medianHours: this.stats.median(lead.hours),
        p85Hours: this.stats.percentile(lead.hours, 85),
      },
      changeFailureRate:
        finished.length > 0
          ? ((failed.length + rolledBack) / finished.length) * 100
          : 0,
      failed: failed.length,
      rollbacks: rolledBack,
      restore: {
        incidents: restore.length,
        medianMinutes: this.stats.median(restore),
        p85Minutes: this.stats.percentile(restore, 85),
      },
      apps: this.perApp(finished, nameOf, rollbacks),
      timeline: this.timeline(finished, from, to, query),
    };
  }

  /**
   * The runs that went back to a tag their instance already ran.
   */
  protected rollbacks<
    T extends { instanceId: string; tag: string; status: string },
  >(rows: T[]): Set<T> {
    const seen = new Map<string, Set<string>>();
    const previous = new Map<string, string>();
    const found = new Set<T>();
    for (const row of rows) {
      if (row.status !== "succeeded") {
        continue;
      }
      const tags = seen.get(row.instanceId) ?? new Set<string>();
      if (tags.has(row.tag) && previous.get(row.instanceId) !== row.tag) {
        found.add(row);
      }
      tags.add(row.tag);
      seen.set(row.instanceId, tags);
      previous.set(row.instanceId, row.tag);
    }
    return found;
  }

  /**
   * Each change against the first successful deploy after it that carries it,
   * by the release tag or a commit of the artifact. A change no deploy names
   * is `unmatched` rather than a guess.
   */
  protected leadTimes(
    rows: Array<{
      tag: string;
      status: string;
      artifactId?: string;
      createdAt: string;
      finishedAt?: string;
    }>,
    built: Array<{ id: string; commitSha?: string }>,
    changes: Array<{ completedAt: string; tag?: string; commits: string[] }>,
  ): { hours: number[]; unmatched: number } {
    const shaOf = new Map(built.map((row) => [row.id, row.commitSha]));
    const shipped = rows.flatMap((row) =>
      row.status === "succeeded"
        ? [
            {
              tag: row.tag,
              sha: row.artifactId ? shaOf.get(row.artifactId) : undefined,
              at: row.finishedAt ?? row.createdAt,
            },
          ]
        : [],
    );
    const hours: number[] = [];
    let unmatched = 0;
    for (const change of changes) {
      const deploy = shipped.find(
        (row) =>
          row.at >= change.completedAt &&
          (row.tag === change.tag ||
            change.commits.some((sha) => row.sha?.startsWith(sha))),
      );
      if (!deploy) {
        unmatched += 1;
        continue;
      }
      hours.push(
        (this.dt.of(deploy.at).valueOf() -
          this.dt.of(change.completedAt).valueOf()) /
          3_600_000,
      );
    }
    return { hours, unmatched };
  }

  protected async restoreMinutes(
    projectId: number,
    from: string,
    to: string,
  ): Promise<number[]> {
    const watched = await this.monitors.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    if (watched.length === 0) {
      return [];
    }
    const rows = await this.incidents.findMany({
      where: {
        monitorId: { inArray: watched.map((row) => row.id) },
        endedAt: { isNotNull: true },
        startedAt: { gte: from, lte: to },
      },
      columns: ["startedAt", "endedAt"],
    });
    return rows.map(
      (row) =>
        (this.dt.of(row.endedAt as string).valueOf() -
          this.dt.of(row.startedAt).valueOf()) /
        60_000,
    );
  }

  protected duration(row: {
    startedAt?: string;
    finishedAt?: string;
  }): number | undefined {
    return row.startedAt && row.finishedAt
      ? (this.dt.of(row.finishedAt).valueOf() -
          this.dt.of(row.startedAt).valueOf()) /
          60_000
      : undefined;
  }

  protected perApp<
    T extends {
      instanceId: string;
      status: string;
      startedAt?: string;
      finishedAt?: string;
    },
  >(
    rows: T[],
    nameOf: Map<string, { app: string; env: string }>,
    rollbacks: Set<T>,
  ): ReportsDelivery["apps"] {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      groups.set(row.instanceId, [...(groups.get(row.instanceId) ?? []), row]);
    }
    return [...groups.entries()]
      .flatMap(([id, group]) => {
        const name = nameOf.get(id);
        return name
          ? [
              {
                app: name.app,
                env: name.env,
                succeeded: group.filter((row) => row.status === "succeeded")
                  .length,
                failed: group.filter((row) => row.status === "failed").length,
                rollbacks: group.filter((row) => rollbacks.has(row)).length,
                medianDurationMinutes: this.stats.median(
                  group.flatMap((row) => this.duration(row) ?? []),
                ),
              },
            ]
          : [];
      })
      .toSorted((a, b) => b.succeeded + b.failed - (a.succeeded + a.failed));
  }

  protected timeline(
    rows: Array<{
      status: string;
      createdAt: string;
      startedAt?: string;
      finishedAt?: string;
    }>,
    from: string,
    to: string,
    query: ReportsQuery,
  ): ReportsDelivery["timeline"] {
    const axis = this.stats.between(from, to);
    const grain = query.grain ?? this.stats.grainFor(axis.length);
    const buckets = new Map<string, typeof rows>();
    for (const day of axis) {
      buckets.set(this.stats.bucket(day, grain), []);
    }
    for (const row of rows) {
      buckets
        .get(this.stats.bucket(row.createdAt.slice(0, 10), grain))
        ?.push(row);
    }
    return [...buckets.entries()].map(([date, group]) => {
      const succeeded = group.filter(
        (row) => row.status === "succeeded",
      ).length;
      return {
        date,
        succeeded,
        failed: group.length - succeeded,
        successRate: group.length > 0 ? (succeeded / group.length) * 100 : 0,
        medianDurationMinutes: this.stats.median(
          group.flatMap((row) => this.duration(row) ?? []),
        ),
      };
    });
  }
}
