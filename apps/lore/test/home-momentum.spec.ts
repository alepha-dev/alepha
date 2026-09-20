import { Alepha, z } from "alepha";
import {
  AnalyticsProvider,
  type AnalyticsQuery,
  type AnalyticsResult,
  type AnalyticsRow,
  MemoryAnalyticsProvider,
} from "alepha/api/analytics";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { HomeController } from "../src/api/controllers/HomeController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreAnalytics } from "../src/api/entities/loreAnalytics.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreAudits } from "../src/api/services/LoreAudits.ts";

/**
 * Home's momentum strip, since it stopped reading `audits` (#E65).
 *
 * Two questions, and the second is the one the epic was nervous about: the
 * numbers still come out right, and the page still renders when the store
 * behind them is down. Every Insights read 500'd for a day on 2026-08-11 and
 * took the Apps pages with it - the landing page must not be able to go the
 * same way.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

/**
 * A backend that refuses to be READ.
 *
 * Reads only: recording has to keep working, because the failure being
 * modelled is Analytics Engine's query endpoint, and a container that
 * cannot record would fail the writes that seed the test instead.
 */
class UnreadableAnalyticsProvider extends MemoryAnalyticsProvider {
  public override async query(
    dataset: Parameters<MemoryAnalyticsProvider["query"]>[0],
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult> {
    if (dataset.name === "project_activity") {
      throw new Error("analytics engine is unavailable");
    }
    return super.query(dataset, query);
  }

  public override async record(
    dataset: Parameters<MemoryAnalyticsProvider["record"]>[0],
    rows: AnalyticsRow[],
  ): Promise<void> {
    await super.record(dataset, rows);
  }
}

interface TestContext {
  alepha: Alepha;
  homeApi: HomeController;
  audits: LoreAudits;
  datasets: LoreAnalytics;
  user: { id: string; roles: string[] };
  projectId: number;
}

const setup = async (unreadable = false): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  if (unreadable) {
    // Before `LoreApi` wires the analytics module: the first substitution of
    // a token wins.
    alepha.with({
      provide: AnalyticsProvider,
      use: UnreadableAnalyticsProvider,
    });
  }
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  await alepha.start();

  const admins = alepha.inject(AdminUserController);
  const projectApi = alepha.inject(ProjectController);
  const fake = alepha.inject(FakeProvider);

  const created = await admins.createUser.fetch(
    {
      body: {
        ...fake.generate(z.object({ username: z.string(), email: z.email() })),
        roles: ["user"],
      },
    },
    { user: adminUser },
  );
  const user = { id: created.data.id, roles: created.data.roles };
  const project = await projectApi.createProject.fetch(
    { body: { title: "Garden a" } },
    { user } as never,
  );

  return {
    alepha,
    homeApi: alepha.inject(HomeController),
    audits: alepha.inject(LoreAudits),
    datasets: alepha.inject(LoreAnalytics),
    user,
    projectId: project.data.id,
  };
};

describe("Home momentum", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("when the dataset answers", () => {
    beforeEach(async () => {
      ctx = await setup();
    });

    it("draws today's bar from what the audit log recorded", async ({
      expect,
    }) => {
      for (let n = 0; n < 3; n++) {
        await ctx.audits.folio.logSuccess("create", {
          ...ctx.audits.scope(ctx.projectId),
          userId: ctx.user.id,
          resourceType: "folio",
          resourceId: `f${n}`,
        });
      }

      const board = await ctx.homeApi.getHomeBoard.fetch({}, {
        user: ctx.user,
      } as never);

      expect(board.data.days).toHaveLength(14);
      const entry = board.data.momentum?.find(
        (row) => row.projectId === ctx.projectId,
      );
      expect(entry?.counts).toHaveLength(14);
      // Today is the newest label, and `createProject` writes an audit row of
      // its own at the app layer, which never reaches the dataset.
      expect(entry?.counts.at(-1)).toBe(3);
      expect(entry?.counts.slice(0, -1).every((count) => count === 0)).toBe(
        true,
      );
    });

    it("gives a project with no activity fourteen zeroes rather than nothing", async ({
      expect,
    }) => {
      const board = await ctx.homeApi.getHomeBoard.fetch({}, {
        user: ctx.user,
      } as never);

      const entry = board.data.momentum?.find(
        (row) => row.projectId === ctx.projectId,
      );
      expect(entry?.counts).toEqual(Array.from({ length: 14 }, () => 0));
    });
  });

  describe("when the dataset is down", () => {
    beforeEach(async () => {
      ctx = await setup(true);
    });

    it("answers the board without momentum instead of failing", async ({
      expect,
    }) => {
      await ctx.audits.folio.logSuccess("create", {
        ...ctx.audits.scope(ctx.projectId),
        userId: ctx.user.id,
      });

      const board = await ctx.homeApi.getHomeBoard.fetch({}, {
        user: ctx.user,
      } as never);

      // ⚠️ Absent, never an empty array: an empty array is fourteen quiet
      // days, which would mute every row in the table as inactive.
      expect(board.data.momentum).toBeUndefined();

      // And everything the bars do not depend on is still there.
      expect(board.data.days).toHaveLength(14);
      expect(board.data.lastActivity).toHaveLength(1);
      expect(board.data.openCounts).toHaveLength(1);
    });
  });
});
