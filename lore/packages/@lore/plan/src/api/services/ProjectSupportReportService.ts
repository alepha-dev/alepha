import { ReportStatistics } from "@lore/core/api";
import type { ReportsQuery, ReportsSupport } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";

/**
 * The Support tab's report (#Q3006): feedback from intake to shipped.
 *
 * Tags are `key=value` by convention only, and a report may carry none, so a
 * report with no `type=` tag is `other` rather than dropped.
 */
export class ProjectSupportReportService {
  protected readonly feedback = $repository(feedback);
  protected readonly quests = $repository(quests);
  protected readonly series = $inject(DashboardFlowSeries);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly dt = $inject(DateTimeProvider);

  protected readonly ageEdges: Array<[key: string, days: number]> = [
    ["under1w", 7],
    ["under1m", 30],
    ["under3m", 90],
    ["under6m", 180],
    ["under1y", 365],
    ["over1y", Number.POSITIVE_INFINITY],
  ];

  async report(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsSupport> {
    const within = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
    const [rows, pending, linked] = await Promise.all([
      this.feedback.findMany({
        where: {
          projectId: { eq: projectId },
          ...(query.from || query.to ? { createdAt: within } : {}),
        },
        columns: ["id", "createdAt", "status", "triagedAt", "tags"],
      }),
      this.feedback.findMany({
        where: { projectId: { eq: projectId }, status: { eq: "pending" } },
        columns: ["createdAt"],
      }),
      this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          feedbackId: { isNotNull: true },
        },
        columns: ["feedbackId", "completedAt"],
      }),
    ]);

    const tagOf = (tags: string[], key: string) =>
      tags
        .find((tag) => tag.startsWith(`${key}=`))
        ?.slice(key.length + 1)
        .toLowerCase();
    const hoursBetween = (from: string, to: string) =>
      Math.max(this.dt.of(to).valueOf() - this.dt.of(from).valueOf(), 0) /
      3_600_000;

    const triaged = rows.filter((row) => row.status !== "pending");
    const triageHours = triaged.flatMap((row) =>
      row.triagedAt ? [hoursBetween(row.createdAt, row.triagedAt)] : [],
    );

    const accepted = rows.filter((row) => row.status === "accepted");
    const questsOf = new Map<number, Array<string | undefined>>();
    for (const quest of linked) {
      if (quest.feedbackId !== undefined) {
        questsOf.set(quest.feedbackId, [
          ...(questsOf.get(quest.feedbackId) ?? []),
          quest.completedAt,
        ]);
      }
    }
    const withQuest = accepted.filter((row) => questsOf.has(row.id));
    // Shipped once every quest it became is done: a report fixed by half of
    // its quests is not fixed.
    const resolution = withQuest.flatMap((row) => {
      const done = questsOf.get(row.id) ?? [];
      if (done.some((at) => !at)) {
        return [];
      }
      const last = (done as string[]).toSorted().at(-1);
      return last ? [hoursBetween(row.createdAt, last)] : [];
    });

    const tally = (values: Array<string | undefined>) => {
      const counts = new Map<string, number>();
      for (const value of values) {
        counts.set(value ?? "", (counts.get(value ?? "") ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .toSorted((a, b) => b.count - a.count);
    };

    const now = this.dt.nowMillis();
    const ageDays = (at: string) =>
      (now - this.dt.of(at).valueOf()) / 86_400_000;

    return {
      intake: this.intake(rows, query, tagOf),
      severity: tally(rows.map((row) => tagOf(row.tags, "severity"))),
      outcomes: {
        accepted: accepted.length,
        rejected: rows.filter((row) => row.status === "rejected").length,
        pending: rows.filter((row) => row.status === "pending").length,
      },
      triage: {
        measured: triageHours.length,
        unknown: triaged.length - triageHours.length,
        medianHours: this.stats.median(triageHours),
        p85Hours: this.stats.percentile(triageHours, 85),
      },
      conversion: {
        accepted: accepted.length,
        withQuest: withQuest.length,
        shipped: resolution.length,
        medianResolutionHours: this.stats.median(resolution),
        p85ResolutionHours: this.stats.percentile(resolution, 85),
      },
      pendingAge: this.ageEdges.map(([key, edge], index) => {
        const lower = this.ageEdges[index - 1]?.[1] ?? 0;
        return {
          key,
          count: pending.filter((row) => {
            const age = ageDays(row.createdAt);
            return age >= lower && age < edge;
          }).length,
        };
      }),
      sources: tally(
        rows.flatMap((row) =>
          row.tags.filter(
            (tag) => tag.startsWith("host=") || tag.startsWith("path="),
          ),
        ),
      ).slice(0, 10),
    };
  }

  protected intake(
    rows: Array<{ createdAt: string; tags: string[] }>,
    query: ReportsQuery,
    tagOf: (tags: string[], key: string) => string | undefined,
  ): ReportsSupport["intake"] {
    const from = query.from ?? this.dt.now().subtract(90, "day").toISOString();
    const axis = this.series.between(from, query.to ?? this.dt.nowISOString());
    const grain = query.grain ?? this.series.grainFor(axis.length);
    const buckets = new Map<
      string,
      { bug: number; feature: number; other: number }
    >();
    for (const day of axis) {
      buckets.set(this.series.bucket(day, grain), {
        bug: 0,
        feature: 0,
        other: 0,
      });
    }
    for (const row of rows) {
      const bucket = buckets.get(
        this.series.bucket(row.createdAt.slice(0, 10), grain),
      );
      if (bucket) {
        const type = tagOf(row.tags, "type");
        bucket[type === "bug" || type === "feature" ? type : "other"] += 1;
      }
    }
    return [...buckets.entries()].map(([date, bucket]) => ({
      date,
      ...bucket,
    }));
  }
}
