import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { FolioLinkService } from "../src/api/services/FolioLinkService.ts";
import { ReadCounter } from "./fixtures/ReadCounter.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  folioController: FolioController;
  links: FolioLinkService;
  counter: ReadCounter;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
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
  alepha.with(ReadCounter);
  await alepha.start();
  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    folioController: alepha.inject(FolioController),
    links: alepha.inject(FolioLinkService),
    counter: alepha.inject(ReadCounter),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const r = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: r.data.id, roles: r.data.roles };
};

/**
 * Renaming a folio rewrites every `[[Old Title]]` pointing at it, which is
 * the one path in Lore whose cost is quadratic: an outer loop over inbound
 * links, each iteration re-syncing that source's own outbound links.
 *
 * These cover the shape rather than only the outcome. The rewrite itself
 * was already correct; what it was not was bounded — one `findById` per
 * inbound link, and one INSERT per link inside each re-sync.
 */
describe("renaming a folio with many inbound links", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * One target, `sources` folios pointing at it by title, each also
   * carrying `extraLinks` references to filler folios so the re-sync
   * inside the rewrite has more than one row to write.
   */
  const seed = async (sources: number, extraLinks: number) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: `Rename ${crypto.randomUUID().slice(0, 8)}` } },
      { user: owner },
    );
    const projectId = project.data.id;

    const target = await ctx.folioController.create.fetch(
      { body: { projectId, title: "Old Title", content: "I am pointed at." } },
      { user: owner },
    );

    const fillers: string[] = [];
    for (let i = 0; i < extraLinks; i += 1) {
      const filler = await ctx.folioController.create.fetch(
        { body: { projectId, title: `Filler ${i}`, content: "." } },
        { user: owner },
      );
      fillers.push(filler.data.title);
    }

    const body = [
      "See [[Old Title]] for the design.",
      ...fillers.map((title) => `Also [[${title}]].`),
    ].join("\n\n");

    for (let i = 0; i < sources; i += 1) {
      await ctx.folioController.create.fetch(
        { body: { projectId, title: `Source ${i}`, content: body } },
        { user: owner },
      );
    }

    return { owner, projectId, target: target.data };
  };

  it("rewrites every inbound reference and keeps the links resolving", async ({
    expect,
  }) => {
    const { owner, target } = await seed(6, 2);

    await ctx.folioController.update.fetch(
      {
        params: { id: target.id },
        body: { title: "New Title", content: target.content },
      },
      { user: owner },
    );

    // Every source's markdown now names the new title, and the link rows
    // survived the re-sync that follows the rewrite. A re-sync that ran
    // against un-rewritten markdown would resolve nothing and drop them,
    // which is the failure mode the rewrite exists to prevent.
    const inbound = await ctx.links.findInbound(target.id);
    expect(inbound).toHaveLength(6);

    const list = await ctx.folioController.list.fetch(
      { query: { projectId: target.projectId } },
      { user: owner },
    );
    const sources = list.data.filter((f) => f.title.startsWith("Source "));
    expect(sources).toHaveLength(6);
    for (const source of sources) {
      const folio = await ctx.folioController.get.fetch(
        { params: { id: source.id } },
        { user: owner },
      );
      expect(folio.data.content).toContain("[[New Title]]");
      expect(folio.data.content).not.toContain("[[Old Title]]");
    }
  });

  it("reads its sources once each, not twice, however many there are", async ({
    expect,
  }) => {
    const measure = async (sources: number) => {
      const { owner, target } = await seed(sources, 2);
      ctx.counter.reset();
      await ctx.folioController.update.fetch(
        {
          params: { id: target.id },
          body: { title: "New Title", content: target.content },
        },
        { user: owner },
      );
      return {
        folios: ctx.counter.of("folios"),
        quests: ctx.counter.of("quests"),
        epics: ctx.counter.of("epics"),
      };
    };

    const two = await measure(2);
    const ten = await measure(10);

    // `sources + 2`, and the slope is the whole assertion.
    //
    // The two constants are the row being renamed and the ONE `findMany`
    // that `readRewriteSources` now issues for every folio source at once.
    // The slope is `syncLinks` re-resolving each rewritten source's own
    // `[[...]]` tokens — one query per source it actually rewrote, not per
    // link it holds, and that one is inherent to re-syncing.
    //
    // The per-link `findById` this replaced made it `2 x sources + 1`.
    // Asserting equality between two fan-ins would NOT have caught that
    // (neither shape is constant); asserting the slope does.
    expect({ two, ten }).toEqual({
      two: { folios: 4, quests: 0, epics: 0 },
      ten: { folios: 12, quests: 0, epics: 0 },
    });
  });

  it("never queries a source kind that does not link to it", async ({
    expect,
  }) => {
    const { owner, target } = await seed(3, 0);

    ctx.counter.reset();
    await ctx.folioController.update.fetch(
      {
        params: { id: target.id },
        body: { title: "New Title", content: target.content },
      },
      { user: owner },
    );

    // `inArray: []` throws, so the empty partitions must be skipped rather
    // than queried with an empty id list. Zero reads is what "skipped"
    // looks like from the outside.
    expect({
      quests: ctx.counter.of("quests"),
      epics: ctx.counter.of("epics"),
    }).toEqual({ quests: 0, epics: 0 });
  });
});
