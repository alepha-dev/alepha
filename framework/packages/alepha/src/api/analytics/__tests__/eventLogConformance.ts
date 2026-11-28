import { z } from "alepha";
import { describe, expect, it } from "vitest";

import type { EventLogProvider } from "../providers/EventLogProvider.ts";
import type {
  AnalyticsEventLog,
  EventLogStoredRow,
} from "../schemas/eventLogSchema.ts";

/**
 * Behaviour every {@link EventLogProvider} must exhibit, exact numbers
 * included: an event log is never sampled.
 *
 * Columns are camelCase on purpose (`appId`, `sessionId`): a relational
 * provider stores them snake_cased, so a two-word name is what exercises
 * name resolution in `where`, `groupBy` and `select`.
 */
export const eventLogConformance = (
  name: string,
  factory: (logs: AnalyticsEventLog[]) => Promise<EventLogProvider>,
) => {
  const log: AnalyticsEventLog = {
    name: "conformance_pageviews",
    index: "appId",
    schema: z.object({
      appId: z.string(),
      sessionId: z.string(),
      path: z.string(),
      country: z.string().nullable().optional(),
      views: z.number(),
      engaged: z.boolean(),
    }),
    keep: "90d",
  };

  const at = (iso: string) => Date.parse(iso);
  const row = (
    iso: string,
    values: Partial<Omit<EventLogStoredRow, "at">>,
  ): EventLogStoredRow => ({
    at: at(iso),
    appId: "a",
    sessionId: "s1",
    path: "/",
    country: "FR",
    views: 1,
    engaged: false,
    ...values,
  });

  const seeded = async (rows: EventLogStoredRow[]) => {
    const provider = await factory([log]);
    await provider.append(log, rows);
    return provider;
  };

  describe(`EventLogProvider conformance: ${name}`, () => {
    it("keeps one row per event: two identical events count twice", async () => {
      const provider = await seeded([
        row("2026-11-02T10:00:00Z", {}),
        row("2026-11-02T10:00:00Z", {}),
      ]);
      const result = await provider.query(log, {
        since: "2026-11-01",
        select: { events: { count: "*" }, views: { sum: "views" } },
      });
      expect(result.rows).toEqual([{ events: 2, views: 2 }]);
      expect(result.estimated).toBe(false);
    });

    it("counts distinct values exactly, per group", async () => {
      const provider = await seeded([
        row("2026-11-02T10:00:00Z", { sessionId: "s1", path: "/a" }),
        row("2026-11-02T11:00:00Z", { sessionId: "s1", path: "/a" }),
        row("2026-11-02T11:00:00Z", { sessionId: "s2", path: "/a" }),
        row("2026-11-02T12:00:00Z", { sessionId: "s3", path: "/b" }),
      ]);
      const result = await provider.query(log, {
        since: "2026-11-01",
        groupBy: ["path"],
        select: {
          visitors: { distinct: "sessionId" },
          views: { sum: "views" },
        },
        orderBy: { key: "visitors", direction: "desc" },
      });
      expect(result.rows).toEqual([
        { path: "/a", visitors: 2, views: 3 },
        { path: "/b", visitors: 1, views: 1 },
      ]);
    });

    it("answers count of a column, min and max, ignoring nulls", async () => {
      const provider = await seeded([
        row("2026-11-02T10:00:00Z", { country: null, views: 0 }),
        row("2026-11-02T10:00:00Z", { country: "FR", views: 4 }),
        row("2026-11-02T10:00:00Z", { country: "DE", views: 2 }),
      ]);
      const result = await provider.query(log, {
        since: "2026-11-01",
        select: {
          located: { count: "country" },
          countries: { distinct: "country" },
          least: { min: "views" },
          most: { max: "views" },
        },
      });
      expect(result.rows).toEqual([
        { located: 2, countries: 2, least: 0, most: 4 },
      ]);
    });

    it("filters on equality and set membership, combined", async () => {
      const provider = await seeded([
        row("2026-11-02T10:00:00Z", { appId: "a", country: "FR" }),
        row("2026-11-02T10:00:00Z", { appId: "a", country: "DE" }),
        row("2026-11-02T10:00:00Z", { appId: "b", country: "FR" }),
        row("2026-11-02T10:00:00Z", { appId: "c", country: "FR" }),
      ]);
      const result = await provider.query(log, {
        since: "2026-11-01",
        where: { appId: { inArray: ["a", "b"] }, country: "FR" },
        select: { events: { count: "*" } },
      });
      expect(result.rows).toEqual([{ events: 2 }]);
    });

    it("filters on a boolean column", async () => {
      const provider = await seeded([
        row("2026-11-02T10:00:00Z", { engaged: true }),
        row("2026-11-02T10:00:00Z", { engaged: false }),
      ]);
      const result = await provider.query(log, {
        since: "2026-11-01",
        groupBy: ["engaged"],
        select: { events: { count: "*" } },
        orderBy: { key: "events", direction: "desc" },
      });
      expect(result.rows).toHaveLength(2);
      expect(
        result.rows
          .map((r) => Boolean(r.engaged))
          .sort((a, b) => Number(a) - Number(b)),
      ).toEqual([false, true]);
    });

    it("returns no rows for an empty inArray, and none for an empty window", async () => {
      const provider = await seeded([row("2026-11-02T10:00:00Z", {})]);
      const empty = await provider.query(log, {
        since: "2026-11-01",
        where: { appId: { inArray: [] } },
        select: { events: { count: "*" } },
      });
      expect(empty.rows).toEqual([]);
      const none = await provider.query(log, {
        since: "2026-12-01",
        select: { events: { count: "*" } },
      });
      expect(none.rows).toEqual([]);
    });

    it("bounds a window by days inclusive and by instants half-open", async () => {
      const provider = await seeded([
        row("2026-11-01T00:00:00Z", {}),
        row("2026-11-02T23:59:59Z", {}),
        row("2026-11-03T00:00:00Z", {}),
      ]);
      const days = await provider.query(log, {
        since: "2026-11-01",
        until: "2026-11-02",
        select: { events: { count: "*" } },
      });
      expect(days.rows).toEqual([{ events: 2 }]);
      const instants = await provider.query(log, {
        from: "2026-11-01T00:00:00Z",
        to: "2026-11-03T00:00:00Z",
        select: { events: { count: "*" } },
      });
      expect(instants.rows).toEqual([{ events: 2 }]);
      const offset = await provider.query(log, {
        from: "2026-11-03T01:00:00+01:00",
        select: { events: { count: "*" } },
      });
      expect(offset.rows).toEqual([{ events: 1 }]);
    });

    it("groups by hour, day, ISO week and month, UTC", async () => {
      const provider = await seeded([
        // Sunday 2026-11-01 belongs to the week of Monday 2026-10-26.
        row("2026-11-01T23:30:00Z", { sessionId: "s1" }),
        row("2026-11-02T00:30:00Z", { sessionId: "s1" }),
        row("2026-11-08T12:00:00Z", { sessionId: "s2" }),
        row("2026-12-01T12:00:00Z", { sessionId: "s3" }),
      ]);
      const read = async (grain: string) =>
        (
          await provider.query(log, {
            since: "2026-10-01",
            groupBy: [grain],
            select: { visitors: { distinct: "sessionId" } },
            orderBy: { key: grain, direction: "asc" },
          })
        ).rows;

      expect(await read("hour")).toEqual([
        { hour: "2026-11-01T23", visitors: 1 },
        { hour: "2026-11-02T00", visitors: 1 },
        { hour: "2026-11-08T12", visitors: 1 },
        { hour: "2026-12-01T12", visitors: 1 },
      ]);
      expect(await read("day")).toEqual([
        { day: "2026-11-01", visitors: 1 },
        { day: "2026-11-02", visitors: 1 },
        { day: "2026-11-08", visitors: 1 },
        { day: "2026-12-01", visitors: 1 },
      ]);
      expect(await read("week")).toEqual([
        { week: "2026-10-26", visitors: 1 },
        { week: "2026-11-02", visitors: 2 },
        { week: "2026-11-30", visitors: 1 },
      ]);
      expect(await read("month")).toEqual([
        { month: "2026-11", visitors: 2 },
        { month: "2026-12", visitors: 1 },
      ]);
    });

    it("groups by a grain and a column together, ordered and limited", async () => {
      const provider = await seeded([
        row("2026-11-02T10:00:00Z", { path: "/a" }),
        row("2026-11-02T10:00:00Z", { path: "/a" }),
        row("2026-11-02T10:00:00Z", { path: "/b" }),
        row("2026-11-03T10:00:00Z", { path: "/c" }),
      ]);
      const result = await provider.query(log, {
        since: "2026-11-01",
        groupBy: ["day", "path"],
        select: { views: { sum: "views" } },
        orderBy: { key: "views", direction: "desc" },
        limit: 1,
      });
      expect(result.rows).toEqual([
        { day: "2026-11-02", path: "/a", views: 2 },
      ]);
    });

    it("refuses an unknown column in where, groupBy or select", async () => {
      const provider = await factory([log]);
      await expect(
        provider.query(log, {
          since: "2026-11-01",
          where: { nope: "x" },
          select: { events: { count: "*" } },
        }),
      ).rejects.toThrow(/nope/);
      await expect(
        provider.query(log, {
          since: "2026-11-01",
          groupBy: ["nope"],
          select: { events: { count: "*" } },
        }),
      ).rejects.toThrow(/nope/);
      await expect(
        provider.query(log, {
          since: "2026-11-01",
          select: { events: { distinct: "nope" } },
        }),
      ).rejects.toThrow(/nope/);
    });
  });
};
