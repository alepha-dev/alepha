import { Alepha, z } from "alepha";
import { audits } from "alepha/api/audits";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { HomeController } from "../src/api/controllers/HomeController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Home's Last activity column: when a project last saw ANY activity.
 *
 * It used to print the project row's own `updatedAt`, which moves only when
 * the project itself is edited, so a project busy with quests every day read
 * "4 months ago". It is now the newest audit event in the project's scope,
 * read by `HomeController.lastActivity` as one index seek per project.
 *
 * The statement is raw SQL (a correlated subquery over a `VALUES` list), so
 * only a real database can say it is right: every case here runs it.
 */
class Probe {
  audits = $repository(audits);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  // Before `start`: the container locks on start.
  const probe = alepha.inject(Probe);
  await alepha.start();

  const admins = alepha.inject(AdminUserController);
  const projectApi = alepha.inject(ProjectController);
  const homeApi = alepha.inject(HomeController);
  const dt = alepha.inject(DateTimeProvider);
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

  const create = async (title: string) =>
    (
      await projectApi.createProject.fetch({ body: { title } }, {
        user,
      } as never)
    ).data;

  /**
   * One event in a project's scope, `days` after now.
   *
   * Stamped explicitly rather than by moving the clock: `createdAt` defaults
   * to the DATABASE's clock (`unixepoch()` on SQLite), which `travel()` does
   * not reach, so a travelled event would still be stamped with real time.
   */
  const event = async (
    projectId: number,
    days: number,
    extra: { updatedAt?: string } = {},
  ) => {
    const at = dt.nowMillis() + days * 24 * 3600_000;
    await probe.audits.create({
      scopeType: "project",
      scopeId: String(projectId),
      type: "quest",
      action: "update",
      userId: user.id,
      createdAt: dt.of(at).toISOString(),
      ...extra,
    });
    return at;
  };

  /**
   * The board's last activity, by project id, in milliseconds.
   */
  const lastActivity = async () => {
    const board = (await homeApi.getHomeBoard.fetch({}, { user } as never))
      .data;
    return new Map(
      board.lastActivity.map((entry) => [
        entry.projectId,
        dt.of(entry.at).valueOf(),
      ]),
    );
  };

  return { alepha, dt, create, event, lastActivity };
};

describe("Home's last activity", () => {
  it("is the newest event of any kind, not the project row's own date", async ({
    expect,
  }) => {
    const ctx = await setup();
    const busy = await ctx.create("Busy");
    const quiet = await ctx.create("Quiet");

    // Work on one project over three days, none of it editing the project
    // row, and the newest event is the one the column reads.
    await ctx.event(busy.id, 1);
    const newest = await ctx.event(busy.id, 3);
    await ctx.event(busy.id, 2);

    const last = await ctx.lastActivity();
    expect(last.get(busy.id)).toBe(newest);
    // Nothing happened in the other one since it was made.
    expect(last.get(quiet.id)).toBeLessThan(newest - 2 * 24 * 3600_000);

    await ctx.alepha.stop();
  });

  it("reads the end of a coalesced burst, not its start", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.create("Burst");

    // Ten edits folded into one row: it starts at `createdAt` and its last
    // edit landed four minutes later.
    const start = ctx.dt.nowMillis() + 24 * 3600_000;
    const end = ctx.dt.of(start + 4 * 60_000).toISOString();
    await ctx.event(project.id, 1, { updatedAt: end });

    const last = await ctx.lastActivity();
    expect(last.get(project.id)).toBe(ctx.dt.of(end).valueOf());

    await ctx.alepha.stop();
  });

  it("answers for every project, including one with no events", async ({
    expect,
  }) => {
    const ctx = await setup();
    const projects = await Promise.all(
      ["One", "Two", "Three"].map((title) => ctx.create(title)),
    );

    const last = await ctx.lastActivity();
    for (const project of projects) {
      // Never empty: with no event later than it, the project's own
      // `updatedAt` stands in, so the column always has a date to show.
      expect(last.get(project.id)).toBeGreaterThanOrEqual(
        ctx.dt.of(project.updatedAt).valueOf(),
      );
    }

    await ctx.alepha.stop();
  });
});
