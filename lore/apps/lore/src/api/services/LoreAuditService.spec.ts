import { Alepha } from "alepha";
import {
  AnalyticsProvider,
  type AnalyticsRow,
  MemoryAnalyticsProvider,
} from "alepha/api/analytics";
import { audits } from "alepha/api/audits";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreAnalytics } from "../entities/loreAnalytics.ts";
import { LoreApi } from "../index.ts";
import { LoreAudits } from "./LoreAudits.ts";

class AuditRepositories {
  audits = $repository(audits);
}

/**
 * A memory backend that refuses every write, to prove the recording is best
 * effort.
 *
 * A provider rather than a fake dataset, because the seam the failure comes
 * through in production is exactly this one: on Workers `record()` is a call
 * into Analytics Engine, which has a failure mode the audit insert does not.
 */
class BrokenAnalyticsProvider extends MemoryAnalyticsProvider {
  public override async record(
    dataset: Parameters<MemoryAnalyticsProvider["record"]>[0],
    rows: AnalyticsRow[],
  ): Promise<void> {
    if (dataset.name === "project_activity") {
      throw new Error("analytics engine is down");
    }
    await super.record(dataset, rows);
  }
}

interface TestContext {
  alepha: Alepha;
  audits: LoreAudits;
  datasets: LoreAnalytics;
  repos: AuditRepositories;
}

const setup = async (broken = false): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  if (broken) {
    // Before `LoreApi`, which wires the analytics module: the FIRST
    // substitution of a token wins.
    alepha.with({
      provide: AnalyticsProvider,
      use: BrokenAnalyticsProvider,
    });
  }
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(AuditRepositories);
  await alepha.start();

  return {
    alepha,
    audits: alepha.inject(LoreAudits),
    datasets: alepha.inject(LoreAnalytics),
    repos,
  };
};

/**
 * Every point the dataset holds, one row per distinct dimension tuple.
 */
const readPoints = async (ctx: TestContext) => {
  const result = await ctx.datasets.activity.query({
    since: "2000-01-01",
    groupBy: ["project", "type", "action", "actor"],
    select: { count: "sum" },
  });
  return result.rows.map((row) => ({
    project: String(row.project),
    type: String(row.type),
    action: String(row.action),
    actor: String(row.actor),
    count: Number(row.count),
  }));
};

describe("LoreAuditService", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("the record path", () => {
    beforeEach(async () => {
      ctx = await setup();
    });

    it("writes one point beside a project-scoped audit row", async ({
      expect,
    }) => {
      await ctx.audits.quest.logSuccess("complete", {
        ...ctx.audits.scope(7),
        userId: "11111111-1111-4111-8111-111111111111",
        resourceType: "quest",
        resourceId: "q1",
      });

      expect(await readPoints(ctx)).toEqual([
        {
          project: "7",
          type: "quest",
          action: "complete",
          actor: "11111111-1111-4111-8111-111111111111",
          count: 1,
        },
      ]);
    });

    it("records `system` as the actor when no token is behind the write", async ({
      expect,
    }) => {
      await ctx.audits.folio.logSuccess("create", ctx.audits.scope(3));

      const [point] = await readPoints(ctx);
      expect(point.actor).toBe("system");
    });

    it("skips an app-layer event rather than filing it under an empty project", async ({
      expect,
    }) => {
      // No `scope()`: a project being created belongs to the deployment, not
      // to a project that does not exist yet.
      await ctx.audits.project.logSuccess("create", {
        resourceType: "project",
        resourceId: "9",
      });

      expect(await readPoints(ctx)).toEqual([]);
      // The audit row itself is untouched by the skip.
      const rows = await ctx.repos.audits.findMany({
        where: { type: { eq: "project" } },
      });
      expect(rows).toHaveLength(1);
    });

    it("counts a coalesced burst once per event, matching SUM(eventCount)", async ({
      expect,
    }) => {
      const options = {
        ...ctx.audits.scope(4),
        userId: "22222222-2222-4222-8222-222222222222",
        resourceType: "quest",
        resourceId: "q9",
      };
      for (let n = 0; n < 5; n++) {
        await ctx.audits.quest.logSuccess("update", options);
      }

      // `quest` coalesces `update` over five minutes, so the audit log holds
      // ONE row carrying the count.
      const rows = await ctx.repos.audits.findMany({
        where: { type: { eq: "quest" }, action: { eq: "update" } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].eventCount).toBe(5);

      const [point] = await readPoints(ctx);
      expect(point.count).toBe(5);
    });
  });

  describe("the query shape Home reads", () => {
    beforeEach(async () => {
      ctx = await setup();
    });

    it("folds hour buckets into days, per project", async ({ expect }) => {
      await ctx.audits.quest.logSuccess("create", ctx.audits.scope(1));
      await ctx.audits.folio.logSuccess("create", ctx.audits.scope(1));
      await ctx.audits.epic.logSuccess("create", ctx.audits.scope(2));

      const result = await ctx.datasets.activity.query({
        since: "2000-01-01",
        where: { project: { inArray: ["1", "2"] } },
        groupBy: ["day", "project"],
        select: { count: "sum" },
      });

      const byProject = new Map(
        result.rows.map((row) => [String(row.project), Number(row.count)]),
      );
      expect(byProject.get("1")).toBe(2);
      expect(byProject.get("2")).toBe(1);
      // One `day` per row, and it is a calendar day rather than an hour.
      for (const row of result.rows) {
        expect(String(row.day)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("answers nothing for a project outside the filter", async ({
      expect,
    }) => {
      await ctx.audits.quest.logSuccess("create", ctx.audits.scope(1));

      const result = await ctx.datasets.activity.query({
        since: "2000-01-01",
        where: { project: { inArray: ["99"] } },
        groupBy: ["day", "project"],
        select: { count: "sum" },
      });
      expect(result.rows).toEqual([]);
    });
  });

  describe("when the dataset refuses the write", () => {
    beforeEach(async () => {
      ctx = await setup(true);
    });

    it("still writes the audit row", async ({ expect }) => {
      await ctx.audits.quest.logSuccess("create", {
        ...ctx.audits.scope(5),
        resourceType: "quest",
        resourceId: "q2",
      });

      const rows = await ctx.repos.audits.findMany({
        where: { type: { eq: "quest" } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("create");
    });
  });
});
