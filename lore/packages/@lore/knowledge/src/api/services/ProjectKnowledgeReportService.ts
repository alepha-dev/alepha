import { ReportStatistics } from "@lore/core/api";
import {
  folioLinks,
  type ReportsKnowledge,
  type ReportsQuery,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { folioDirectories } from "../entities/folioDirectories.ts";
import { folioRevisions } from "../entities/folioRevisions.ts";
import { folios } from "../entities/folios.ts";

/**
 * The Knowledge tab's report (#Q3007): how the project's memory is kept.
 *
 * Reads metadata only: never a folio's content, which a protected folio holds
 * encrypted, and never `contentSnapshot`, the heavy column of revisions.
 */
export class ProjectKnowledgeReportService {
  protected readonly folios = $repository(folios);
  protected readonly revisions = $repository(folioRevisions);
  protected readonly directories = $repository(folioDirectories);
  protected readonly links = $repository(folioLinks);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly dt = $inject(DateTimeProvider);

  async report(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsKnowledge> {
    const within = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
    const bounded = !!query.from || !!query.to;
    const [rows, revisions, directories, links] = await Promise.all([
      this.folios.findMany({
        where: { projectId: { eq: projectId } },
        columns: [
          "id",
          "shortId",
          "title",
          "createdAt",
          "updatedAt",
          "pinned",
          "directoryId",
        ],
      }),
      this.revisions.findMany({
        where: {
          ...(bounded ? { at: within } : {}),
          exists: this.folios.subquery({
            id: { eq: this.revisions.table.folioId },
            projectId: { eq: projectId },
          }),
        },
        columns: ["folioId", "at", "action"],
      }),
      this.directories.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "name", "parentId"],
      }),
      this.links.findMany({
        where: {
          exists: this.folios.subquery({
            id: { eq: this.links.table.toId },
            projectId: { eq: projectId },
          }),
        },
        columns: ["toId"],
      }),
    ]);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ref = (row: (typeof rows)[number]) => ({
      shortId: row.shortId,
      title: row.title,
    });
    const now = this.dt.nowMillis();
    const days = (at: string) => (now - this.dt.of(at).valueOf()) / 86_400_000;

    const countBy = <T>(values: T[]) => {
      const counts = new Map<T, number>();
      for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return counts;
    };

    const staleDays = query.staleDays ?? 90;
    const stale = rows
      .filter((row) => days(row.updatedAt) > staleDays)
      .toSorted(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          a.updatedAt.localeCompare(b.updatedAt),
      );

    const inbound = countBy(links.map((link) => link.toId));
    const orphans = rows.filter((row) => !row.pinned && !inbound.has(row.id));
    const top = query.top ?? 10;

    return {
      total: rows.length,
      activity: this.activity(rows, revisions, query),
      mostRevised: [...countBy(revisions.map((it) => it.folioId)).entries()]
        .flatMap(([id, count]) => {
          const row = byId.get(id);
          return row ? [{ ...ref(row), revisions: count }] : [];
        })
        .toSorted((a, b) => b.revisions - a.revisions)
        .slice(0, top),
      stale: stale.slice(0, 20).map((row) => ({
        ...ref(row),
        pinned: row.pinned,
        days: days(row.updatedAt),
      })),
      staleCount: stale.length,
      staleDays,
      orphans: orphans.slice(0, 20).map(ref),
      orphanCount: orphans.length,
      medianLinksPerFolio: this.stats.median(
        rows.map((row) => inbound.get(row.id) ?? 0),
      ),
      mostLinked: [...inbound.entries()]
        .flatMap(([id, count]) => {
          const row = byId.get(id);
          return row ? [{ ...ref(row), links: count }] : [];
        })
        .toSorted((a, b) => b.links - a.links)
        .slice(0, top),
      byDirectory: this.byDirectory(rows, directories),
      reverts: revisions.filter((it) => it.action === "revert").length,
    };
  }

  protected activity(
    rows: Array<{ createdAt: string }>,
    revisions: Array<{ at: string }>,
    query: ReportsQuery,
  ): ReportsKnowledge["activity"] {
    const axis = this.stats.between(
      query.from ?? this.dt.now().subtract(90, "day").toISOString(),
      query.to ?? this.dt.nowISOString(),
    );
    const grain = query.grain ?? this.stats.grainFor(axis.length);
    const buckets = new Map(
      axis.map((day) => [
        this.stats.bucket(day, grain),
        { created: 0, revised: 0 },
      ]),
    );
    for (const row of rows) {
      const bucket = buckets.get(
        this.stats.bucket(row.createdAt.slice(0, 10), grain),
      );
      if (bucket) bucket.created += 1;
    }
    for (const revision of revisions) {
      const bucket = buckets.get(
        this.stats.bucket(revision.at.slice(0, 10), grain),
      );
      if (bucket) bucket.revised += 1;
    }
    return [...buckets.entries()].map(([date, bucket]) => ({
      date,
      ...bucket,
    }));
  }

  /**
   * Per top-level directory, as `FoliosByDirectoryMetric` folds it.
   */
  protected byDirectory(
    rows: Array<{ directoryId?: string }>,
    directories: Array<{ id: string; name: string; parentId?: string }>,
  ): ReportsKnowledge["byDirectory"] {
    const byId = new Map(directories.map((dir) => [dir.id, dir]));
    const top = (id: string | undefined): string => {
      let current = id ? byId.get(id) : undefined;
      // Bounded by the directory count: a cycle can never spin forever.
      for (
        let hops = 0;
        current?.parentId && hops < directories.length;
        hops += 1
      ) {
        current = byId.get(current.parentId) ?? current;
        if (!current.parentId) break;
      }
      return current?.name ?? "/";
    };
    const counts = new Map<string, number>();
    for (const row of rows) {
      const name = top(row.directoryId);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .toSorted((a, b) => b.count - a.count);
  }
}
