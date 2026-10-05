import { $hook, Alepha, AlephaError, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { folioNames } from "../src/api/entities/folioNames.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  type AppendedRevision,
  FolioHistoryService,
} from "../src/api/services/FolioHistoryService.ts";
import { ResourceLinkService } from "../src/api/services/ResourceLinkService.ts";

/**
 * Lands a second request between the first one's gate read and its write,
 * like `quest-version-races.spec.ts`: fires once, on the next folio read.
 */
class Interleave {
  public next?: () => Promise<unknown>;

  onRead = $hook({
    on: "repository:read:after",
    handler: async ({ tableName }) => {
      if (tableName !== "folios" || !this.next) return;
      const run = this.next;
      this.next = undefined;
      await run();
    },
  });
}

/**
 * The revision written AFTER the folio row fails, the way a D1 statement
 * failing mid-request would.
 */
class FailingRecordHistory extends FolioHistoryService {
  public fail = false;

  public override async recordRevision(
    ...args: Parameters<FolioHistoryService["recordRevision"]>
  ): Promise<AppendedRevision> {
    if (this.fail) throw new AlephaError("revision insert failed");
    return super.recordRevision(...args);
  }
}

/**
 * The link wipe an encrypt runs before its write fails.
 */
class FailingWipeLinks extends ResourceLinkService {
  public fail = false;

  public override async syncLinks(
    ...args: Parameters<ResourceLinkService["syncLinks"]>
  ): ReturnType<ResourceLinkService["syncLinks"]> {
    if (this.fail && args[1] === "") {
      throw new AlephaError("link wipe failed");
    }
    return super.syncLinks(...args);
  }
}

class Rows {
  names = $repository(folioNames);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

const setup = async () => {
  // Transactions off, as on D1: the write order is the only protection.
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "silent",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATABASE_TRANSACTIONS: false,
    },
  });
  alepha.with({ provide: FolioHistoryService, use: FailingRecordHistory });
  alepha.with({ provide: ResourceLinkService, use: FailingWipeLinks });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  const interleave = alepha.inject(Interleave);
  const rows = alepha.inject(Rows);
  await alepha.start();

  const fake = alepha.inject(FakeProvider).generate(userDataSchema);
  const created = await alepha
    .inject(AdminUserController)
    .createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
  const user = { id: created.data.id, roles: created.data.roles };
  const project = await alepha
    .inject(ProjectController)
    .createProject.fetch({ body: { title: "Folio order" } }, { user });

  const folios = alepha.inject(FolioController);
  const history = alepha.inject(FolioHistoryService) as FailingRecordHistory;
  const links = alepha.inject(ResourceLinkService) as FailingWipeLinks;
  const create = async (title: string, content: string) =>
    (
      await folios.create.fetch(
        { body: { projectId: project.data.id, title, content } },
        { user },
      )
    ).data;
  const bodies = async (folioId: string, live: string) =>
    (await history.listRevisions(folioId)).map((it) =>
      history.contentOf(it, live),
    );

  // Pin a folio's newest revision, so the next edit by the same author is
  // a revision of its own rather than folded into it (coalescing).
  const pinHead = async (folioId: string) => {
    const [head] = await history.listRevisions(folioId);
    await folios.pinHistory.fetch(
      { params: { id: folioId, revisionId: head!.id }, body: { pinned: true } },
      { user },
    );
  };

  return {
    pinHead,
    alepha,
    user,
    folios,
    history,
    links,
    interleave,
    rows,
    create,
    bodies,
  };
};

describe("folio update and revert without transactions (#Q2549)", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  afterEach(async () => {
    await ctx?.alepha.stop();
  });

  it("keeps the pre-edit body in history when the revision after the write fails", async ({
    expect,
  }) => {
    ctx = await setup();
    const folio = await ctx.create("Notes", "first body");
    await ctx.pinHead(folio.id);

    ctx.history.fail = true;
    const saved = await ctx.folios.update.fetch(
      { params: { id: folio.id }, body: { content: "second body" } },
      { user: ctx.user },
    );
    ctx.history.fail = false;

    expect(saved.data.content).toBe("second body");
    expect(await ctx.bodies(folio.id, "second body")).toContain("first body");
  });

  it("leaks no plaintext revision when an encrypt fails midway", async ({
    expect,
  }) => {
    ctx = await setup();
    const folio = await ctx.create("Secret", "plaintext [[#F1]]");

    ctx.links.fail = true;
    await expect(
      ctx.folios.update.fetch(
        {
          params: { id: folio.id },
          body: { protected: true, content: '{"v":1,"envelope":"x"}' },
        },
        { user: ctx.user },
      ),
    ).rejects.toThrow("link wipe failed");
    ctx.links.fail = false;

    // The purge ran before anything else: whatever state the folio is in,
    // no plaintext snapshot of it survives.
    expect(await ctx.history.listRevisions(folio.id)).toHaveLength(0);
  });

  it("answers 409 to a write that lands between its read and its own write", async ({
    expect,
  }) => {
    ctx = await setup();
    const folio = await ctx.create("Raced", "base");

    ctx.interleave.next = () =>
      ctx.folios.update.fetch(
        { params: { id: folio.id }, body: { content: "concurrent" } },
        { user: ctx.user },
      );

    await expect(
      ctx.folios.update.fetch(
        { params: { id: folio.id }, body: { content: "mine" } },
        { user: ctx.user },
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [head] = await ctx.history.listRevisions(folio.id);
    expect(head).toBeDefined();
  });

  it("a revert to an older title holds that name", async ({ expect }) => {
    ctx = await setup();
    const folio = await ctx.create("Alpha", "one");
    await ctx.pinHead(folio.id);
    await ctx.folios.update.fetch(
      { params: { id: folio.id }, body: { title: "Beta", content: "two" } },
      { user: ctx.user },
    );
    const revisions = await ctx.history.listRevisions(folio.id);
    const original = revisions.find((it) => it.titleSnapshot === "Alpha");
    expect(original).toBeDefined();

    const reverted = await ctx.folios.revertHistory.fetch(
      { params: { id: folio.id, revisionId: original!.id } },
      { user: ctx.user },
    );

    expect(reverted.data.title).toBe("Alpha");
    const reserved = await ctx.rows.names.findMany({
      where: { entityId: { eq: folio.id } },
    });
    expect(reserved.map((it) => it.lowerName)).toEqual(["alpha"]);
    // And the name it left is free again.
    const beta = await ctx.create("Beta", "");
    expect(beta.title).toBe("Beta");
  });
});
