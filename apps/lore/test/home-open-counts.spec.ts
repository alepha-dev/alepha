import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { HomeController } from "../src/api/controllers/HomeController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { blights } from "../src/api/entities/blights.ts";
import { epics } from "../src/api/entities/epics.ts";
import { feedback } from "../src/api/entities/feedback.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Home's Open column beyond quests: draft epics, open blights and pending
 * feedback per project, read by `HomeController.openCounts` in one raw
 * statement.
 *
 * Raw SQL skips what the repositories do on their own, the soft delete
 * above all, so every filter the sidebar badges apply is exercised here
 * against a real database: the status, `deletedAt`, and the project.
 */
class Probe {
  epics = $repository(epics);
  blights = $repository(blights);
  feedback = $repository(feedback);
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

  let sequence = 0;
  const epic = (projectId: number, status: string) =>
    probe.epics.create({
      projectId,
      number: ++sequence,
      title: `Epic ${sequence}`,
      status: status as never,
    });
  const blight = (projectId: number, status: string) =>
    probe.blights.create({
      projectId,
      fingerprint: `fp-${++sequence}`,
      name: "TypeError",
      message: "x is undefined",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      status,
    });
  const request = (projectId: number, status: string) =>
    probe.feedback.create({
      projectId,
      shortId: ++sequence,
      title: "Please add dark mode",
      description: "",
      status: status as never,
    });

  const openCounts = async () => {
    const board = (await homeApi.getHomeBoard.fetch({}, { user } as never))
      .data;
    return new Map(board.openCounts.map((entry) => [entry.projectId, entry]));
  };

  return { alepha, probe, create, epic, blight, request, openCounts };
};

describe("Home's open counts", () => {
  it("counts what each sidebar badge counts, per project", async ({
    expect,
  }) => {
    const ctx = await setup();
    const busy = await ctx.create("Busy");
    const other = await ctx.create("Other");

    // Epics: drafts only. A ready epic's quests are in the quest count.
    await ctx.epic(busy.id, "draft");
    await ctx.epic(busy.id, "draft");
    await ctx.epic(busy.id, "ready");
    // Blights: open only.
    await ctx.blight(busy.id, "open");
    await ctx.blight(busy.id, "resolved");
    // Feedback: pending only.
    await ctx.request(busy.id, "pending");
    await ctx.request(busy.id, "accepted");
    // Another project's rows stay with it.
    await ctx.epic(other.id, "draft");

    const counts = await ctx.openCounts();
    expect(counts.get(busy.id)).toEqual({
      projectId: busy.id,
      epics: 2,
      blights: 1,
      feedback: 1,
    });
    expect(counts.get(other.id)).toEqual({
      projectId: other.id,
      epics: 1,
      blights: 0,
      feedback: 0,
    });

    await ctx.alepha.stop();
  });

  it("leaves soft-deleted epics and feedback out", async ({ expect }) => {
    // The repositories filter `deletedAt` on their own; raw SQL does not, so
    // the statement has to, and this is where forgetting it would show.
    const ctx = await setup();
    const project = await ctx.create("Tidy");
    const gone = await ctx.epic(project.id, "draft");
    const withdrawn = await ctx.request(project.id, "pending");
    await ctx.probe.epics.deleteById(gone.id);
    await ctx.probe.feedback.deleteById(withdrawn.id);

    const counts = await ctx.openCounts();
    expect(counts.get(project.id)).toEqual({
      projectId: project.id,
      epics: 0,
      blights: 0,
      feedback: 0,
    });

    await ctx.alepha.stop();
  });
});
