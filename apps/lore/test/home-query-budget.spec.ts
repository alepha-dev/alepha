import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { HomeController } from "../src/api/controllers/HomeController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * How many SQL statements Home costs, and that the number does not grow with
 * the number of projects.
 *
 * On D1 every statement is a network round trip from the Worker, so a read
 * per project (an N+1) turns a page of forty projects into forty-odd calls.
 * Home's two requests are written as grouped reads over the whole project
 * list instead, and this pins that: the same count for 3 projects and for 8.
 *
 * The budget is pinned too, so adding a statement is a decision rather than
 * an accident: raise the number here in the same change, and say why.
 *
 * Statements are counted off the SQLite driver's trace log, which every
 * query passes through, raw `database.run` SQL included.
 */
const BUDGET = {
  // Projects; areas; open quests (epic gate + quests); capabilities;
  // ownership (members + projects).
  getHomeOverview: 7,
  // Projects; momentum; last activity; open epics, blights and feedback in
  // one statement. It was 5 while the Recent activity panel existed - its own
  // read, plus one more for actor names whenever that feed had any - and the
  // panel was deleted in #E64.
  getHomeBoard: 4,
};

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const statementsFor = async (projectCount: number) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "trace", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  }).with({ provide: LogDestinationProvider, use: MemoryDestinationProvider });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  await alepha.start();

  const logs = alepha.inject(MemoryDestinationProvider);
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
  for (let i = 0; i < projectCount; i++) {
    // Letters, not numbers: a title that slugs to `project-0` is reserved.
    await projectApi.createProject.fetch(
      { body: { title: `Garden ${String.fromCharCode(97 + i)}` } },
      { user } as never,
    );
  }

  const statements = () =>
    logs.logs.filter(
      (entry) =>
        entry.level === "TRACE" &&
        /^\s*(select|insert|update|delete|with)\b/i.test(entry.message),
    ).length;
  const count = async (call: () => Promise<unknown>) => {
    const before = statements();
    await call();
    return statements() - before;
  };

  const result = {
    getHomeOverview: await count(() =>
      projectApi.getHomeOverview.fetch({}, { user } as never),
    ),
    getHomeBoard: await count(() =>
      homeApi.getHomeBoard.fetch({}, { user } as never),
    ),
  };
  await alepha.stop();
  return result;
};

describe("Home's query budget", () => {
  it("runs the same statements for 3 projects as for 8", async ({ expect }) => {
    const few = await statementsFor(3);
    const many = await statementsFor(8);

    expect(many).toEqual(few);
  });

  it("stays within its pinned budget", async ({ expect }) => {
    expect(await statementsFor(3)).toEqual(BUDGET);
  });
});
