import { $hook, Alepha, z } from "alepha";
import { $entity, $repository, db, type Repository } from "alepha/orm";
import { $action, ServerProvider } from "alepha/server";
import { ServerLinksProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { $owns } from "../primitives/$owns.ts";

const projects = $entity({
  name: "memo_projects",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const quests = $entity({
  name: "memo_quests",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    title: z.text(),
  }),
});

const members = $entity({
  name: "memo_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    userId: z.text(),
  }),
});

/**
 * Counts the reads a gate performs, at the repository rather than at the
 * guard.
 *
 * Counting guard entries would prove nothing: seven guards each finding a
 * memoized promise is the PASS condition, so a guard counter reads seven
 * whether the memo works or not. Counting loads is what tells the two apart,
 * and it stays honest under the ORM's own query cache, which suppresses the
 * SQL but not the call.
 */
class CountingRepository {
  public calls = 0;

  constructor(protected readonly inner: Repository<any>) {}

  public get tableName(): string {
    return this.inner.tableName;
  }

  public findById(id: string | number, opts?: unknown): Promise<unknown> {
    this.calls++;
    this.lastOptions = opts;
    return this.inner.findById(id, opts as never);
  }

  public findOne(query: unknown, opts?: unknown): Promise<unknown> {
    this.calls++;
    return this.inner.findOne(query as never, opts as never);
  }

  public lastOptions: unknown;
}

const QUEST_IDS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"];

const createApp = (cache?: { ttl: number }) => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  }).with(ServerLinksProvider);

  class App {
    projects = $repository(projects);
    quests = $repository(quests);
    members = $repository(members);

    countedProjects = new CountingRepository(this.projects);
    countedQuests = new CountingRepository(this.quests);
    countedMembers = new CountingRepository(this.members);

    /**
     * Authenticates every request without a realm or a token: `$secure`
     * reads `request.user` when a previous middleware set one, and what this
     * spec is about is the reads, not the credential channel.
     */
    protected readonly authenticate = $hook({
      on: "server:onRequest",
      priority: "first",
      handler: ({ request }) => {
        request.user = { id: "u2", realm: "default", roles: [] };
      },
    });

    protected gate() {
      return $owns({
        repository: () => this.countedQuests as unknown as Repository<any>,
        param: "id",
        through: {
          column: "projectId",
          repository: () => this.countedProjects as unknown as Repository<any>,
        },
        owner: "createdBy",
        cache,
        via: {
          repository: () => this.countedMembers as unknown as Repository<any>,
          resource: "projectId",
          user: "userId",
        },
      });
    }

    // Seven separate actions, so the batch runs seven separate `$action.run()`
    // forks - the arrangement that made a lazily-created memo invisible.
    readQ1 = this.read();
    readQ2 = this.read();
    readQ3 = this.read();
    readQ4 = this.read();
    readQ5 = this.read();
    readQ6 = this.read();
    readQ7 = this.read();

    protected read() {
      return $action({
        schema: {
          params: z.object({ id: z.text() }),
          response: z.text(),
        },
        use: [this.gate()],
        handler: ({ params }) => params.id,
      });
    }

    public counts() {
      return {
        quests: this.countedQuests.calls,
        projects: this.countedProjects.calls,
        members: this.countedMembers.calls,
      };
    }

    public reset() {
      this.countedQuests.calls = 0;
      this.countedProjects.calls = 0;
      this.countedMembers.calls = 0;
    }
  }

  return { alepha, app: alepha.inject(App) };
};

const seed = async (app: { projects: any; quests: any; members: any }) => {
  await app.projects.create({ id: "p1", createdBy: "u1", title: "Alpha" });
  await app.members.create({ id: "m1", projectId: "p1", userId: "u2" });
  for (const id of QUEST_IDS) {
    await app.quests.create({ id, projectId: "p1", title: id });
  }
};

const batch = async (alepha: Alepha, ids: string[]) => {
  const res = await fetch(
    `${alepha.inject(ServerProvider).hostname}/api/_batch`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        ids.map((id, i) => ({ action: `readQ${i + 1}`, params: { id } })),
      ),
    },
  );
  return (await res.json()) as Array<{ status: number; data?: string }>;
};

describe("$owns request memo", () => {
  it("resolves one (user, project) pair ONCE across a seven-action batch", async ({
    expect,
  }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);
    app.reset();

    const results = await batch(alepha, QUEST_IDS);

    expect(results.map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200, 200, 200,
    ]);

    // Exact counts, never `toBeLessThan`: an upper bound passes just as
    // happily when a later change removes the gate altogether, which is the
    // one failure this must never cause.
    expect(app.counts()).toEqual({
      // The resource read is deliberately NOT memoized - seven different
      // quests, and the row a handler is about to work on must be the row its
      // own gate read.
      quests: 7,
      // The whole point: one project read and one membership read for seven
      // gates, where there used to be seven of each.
      projects: 1,
      members: 1,
    });
  });

  it("does not carry the memo into the next request", async ({ expect }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);
    app.reset();

    // Two batches, back to back on the same server. A memo that outlived its
    // request would answer the second batch from the first one's rows, and
    // with it a membership revoked in between.
    await batch(alepha, QUEST_IDS);
    await batch(alepha, QUEST_IDS);

    expect(app.counts()).toEqual({ quests: 14, projects: 2, members: 2 });
  });

  it("re-reads membership after it is revoked between requests", async ({
    expect,
  }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);

    expect((await batch(alepha, ["q1"]))[0].status).toBe(200);

    await app.members.deleteById("m1");

    expect((await batch(alepha, ["q1"]))[0].status).toBe(403);
  });

  it("works with no request layer at all", async ({ expect }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);
    app.reset();

    // A job, a CLI command, a direct call in a test: no `server:onRequest`
    // ever fired, so there is no memo to find. Every read simply happens.
    await alepha.context.run(async () => {
      alepha.set("alepha.security.user", {
        id: "u2",
        realm: "default",
        roles: [],
      } as any);

      expect(await app.readQ1.run({ params: { id: "q1" } })).toBe("q1");
      expect(await app.readQ2.run({ params: { id: "q2" } })).toBe("q2");
    });

    expect(app.counts()).toEqual({ quests: 2, projects: 2, members: 2 });
  });

  it("passes cache through to the authority read only", async ({ expect }) => {
    const { alepha, app } = createApp({ ttl: 30_000 });
    await alepha.start();
    await seed(app);
    app.reset();

    await batch(alepha, ["q1"]);

    // The project row carries configuration and may be served stale for a
    // window. The quest is the row the handler works on, and the membership
    // row IS the grant - neither may be.
    expect(app.countedProjects.lastOptions).toEqual({
      cache: { ttl: 30_000 },
    });
    // Not `{}`: the resource read on a hop takes the plain `findById(id)`
    // path, so it is not merely uncached - it is never handed options at all.
    expect(app.countedQuests.lastOptions).toBeUndefined();
  });
});
