import { $hook, Alepha, AlephaError, z } from "alepha";
import { $entity, $repository, db, type Repository } from "alepha/orm";
import { $action, ForbiddenError, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $owns } from "../primitives/$owns.ts";
import { $role } from "../primitives/$role.ts";
import {
  type ResourceGrantsDecision,
  ResourceGrantsProvider,
  type ResourceGrantsRequest,
} from "../providers/ResourceGrantsProvider.ts";

const projects = $entity({
  name: "req_projects",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const members = $entity({
  name: "req_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    userId: z.text(),
    rank: z.text(),
  }),
});

/**
 * A grants provider that answers from the join row alone, which is the shape
 * the seam exists for: the rank is a column on a row the gate already read,
 * so this implementation issues no query of its own.
 */
class RankGrantsProvider extends ResourceGrantsProvider {
  public seen: ResourceGrantsRequest[] = [];

  static readonly SETS: Record<string, string[]> = {
    owner: ["project:read", "project:update", "quest:create"],
    contributor: ["project:read", "quest:create"],
    viewer: ["project:read"],
  };

  public override async check(
    request: ResourceGrantsRequest,
  ): Promise<ResourceGrantsDecision> {
    this.seen.push(request);

    const rank = (request.membership?.rank as string | undefined) ?? "viewer";
    const held = RankGrantsProvider.SETS[rank] ?? [];
    const missing = request.requires.filter((it) => !held.includes(it));

    if (missing.length) {
      return {
        allowed: false,
        message: `Your rank (${rank}) does not grant ${missing.join(", ")}`,
      };
    }

    return { allowed: true };
  }
}

/**
 * The realm every case here signs in against.
 *
 * ⚠️ `ownership: true` is load-bearing, and the placeholder realm's `admin`
 * role is not a substitute for it: that role grants `*` unrestricted, which
 * `$secure` resolves to `ownership: false`, which `$owns` reads as a
 * privileged identity and bypasses on. Under it every case below passes
 * whatever the gate does. This is the shape a real application uses - an
 * ordinary signed-in user holding every non-admin permission, narrowed to
 * rows they own.
 */
class Roles {
  member = $role({
    name: "member",
    permissions: [{ name: "*", ownership: true }],
  });
}

/**
 * Counts the reads the gate performs, at the repository. Same reasoning as
 * `$owns-memo.spec.ts`: counting guard entries would read the same whether
 * the memo works or not.
 */
class CountingRepository {
  public calls = 0;

  protected readonly inner: Repository<any>;

  constructor(inner: Repository<any>) {
    this.inner = inner;
  }

  public get tableName(): string {
    return this.inner.tableName;
  }

  public findById(id: string | number, opts?: unknown): Promise<unknown> {
    this.calls++;
    return this.inner.findById(id, opts as never);
  }

  public findOne(query: unknown, opts?: unknown): Promise<unknown> {
    this.calls++;
    return this.inner.findOne(query as never, opts as never);
  }
}

interface AppOptions {
  /**
   * Which identity every request arrives as. `member` (declared above) holds
   * `*` narrowed to ownership, so it passes the APPLICATION-scope half of
   * `requires` without turning into the privileged bypass; an empty role list
   * fails that half.
   */
  userId?: string;
  roles?: string[];
  ranks?: boolean;
}

const createApp = (options: AppOptions = {}) => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });

  if (options.ranks) {
    alepha.with({ provide: ResourceGrantsProvider, use: RankGrantsProvider });
  }

  class App {
    projects = $repository(projects);
    members = $repository(members);

    countedProjects = new CountingRepository(this.projects);
    countedMembers = new CountingRepository(this.members);

    /**
     * The identity, for the two ways a gated action is reached here.
     *
     * `action.run()` takes it as an option; an HTTP request has to carry it,
     * so the hook below puts the same token on the request. Both spellings
     * have to agree, or the fan-out would be measuring a different caller
     * from the direct calls.
     */
    public token() {
      return {
        id: options.userId ?? "u2",
        realm: "default",
        roles: options.roles ?? ["member"],
      };
    }

    protected readonly authenticate = $hook({
      on: "server:onRequest",
      priority: "first",
      handler: ({ request }) => {
        request.user = this.token();
      },
    });

    /**
     * The via-only shape: no `owner`, so membership plus rank is the whole
     * answer and the creator holds no implicit bypass.
     */
    protected gate(requires?: string | string[]) {
      return $owns({
        repository: () => this.countedProjects as unknown as Repository<any>,
        param: "id",
        requires,
        via: {
          repository: () => this.countedMembers as unknown as Repository<any>,
          resource: "projectId",
          user: "userId",
        },
      });
    }

    /**
     * The other shape: an `owner` column AND a join, which is what the
     * membership read for an owner is about.
     */
    protected ownerGate(requires?: string | string[]) {
      return $owns({
        repository: () => this.countedProjects as unknown as Repository<any>,
        param: "id",
        owner: "createdBy",
        requires,
        via: {
          repository: () => this.countedMembers as unknown as Repository<any>,
          resource: "projectId",
          user: "userId",
        },
      });
    }

    readProject = this.read(this.gate());
    createQuest = this.read(this.gate("quest:create"));
    updateProject = this.read(this.gate("project:update"));
    ownerCreateQuest = this.read(this.ownerGate("quest:create"));
    ownerRead = this.read(this.ownerGate());

    protected read(gate: ReturnType<typeof $owns>) {
      return $action({
        schema: {
          params: z.object({ id: z.text() }),
          response: z.text(),
        },
        use: [gate],
        handler: ({ params }) => params.id,
      });
    }

    /**
     * One HTTP request fanning out into three gated actions, the shape
     * `/api/_batch` produces. Reproduced locally for the reason
     * `$owns-memo.spec.ts` gives: importing `alepha/server/links` from here
     * would add a module edge the build's cycle check refuses.
     */
    fanOut = $action({
      method: "POST",
      path: "/fan-out-requires",
      schema: {
        body: z.object({ id: z.text() }),
        response: z.array(z.text()),
      },
      handler: async ({ body }) =>
        Promise.all(
          [this.readProject, this.createQuest, this.updateProject].map((it) =>
            it.run({ params: { id: body.id } }),
          ),
        ),
    });

    public counts() {
      return {
        projects: this.countedProjects.calls,
        members: this.countedMembers.calls,
      };
    }

    public reset() {
      this.countedProjects.calls = 0;
      this.countedMembers.calls = 0;
    }
  }

  alepha.inject(Roles);

  return { alepha, app: alepha.inject(App) };
};

const seed = async (
  app: { projects: any; members: any },
  rank = "contributor",
) => {
  await app.projects.create({ id: "p1", createdBy: "u1", title: "Alpha" });
  await app.members.create({
    id: "m1",
    projectId: "p1",
    userId: "u2",
    rank,
  });
};

describe("$owns requires", () => {
  it("allows whatever the call site requires when no grants provider is registered", async ({
    expect,
  }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app, "viewer");

    // `viewer` would be refused `project:update` by the rank provider below.
    // With none registered the second layer does not exist, which is the
    // whole promise made to an application that never adopts ranks.
    await expect(
      app.updateProject.run({ params: { id: "p1" } }, { user: app.token() }),
    ).resolves.toBe("p1");
  });

  it("refuses when the substituted provider denies, with the provider's message", async ({
    expect,
  }) => {
    const { alepha, app } = createApp({ ranks: true });
    await alepha.start();
    await seed(app, "viewer");

    await expect(
      app.createQuest.run({ params: { id: "p1" } }, { user: app.token() }),
    ).rejects.toThrow("Your rank (viewer) does not grant quest:create");

    await expect(
      app.readProject.run({ params: { id: "p1" } }, { user: app.token() }),
    ).resolves.toBe("p1");
  });

  it("allows when the rank carries the permission", async ({ expect }) => {
    const { alepha, app } = createApp({ ranks: true });
    await alepha.start();
    await seed(app, "contributor");

    await expect(
      app.createQuest.run({ params: { id: "p1" } }, { user: app.token() }),
    ).resolves.toBe("p1");
  });

  it("hands the provider rows, never ids", async ({ expect }) => {
    const { alepha, app } = createApp({ ranks: true });
    await alepha.start();
    await seed(app, "contributor");

    await app.createQuest.run({ params: { id: "p1" } }, { user: app.token() });

    const grants = alepha.inject(ResourceGrantsProvider) as RankGrantsProvider;
    expect(grants.seen).toHaveLength(1);
    expect(grants.seen[0].authority).toMatchObject({
      id: "p1",
      title: "Alpha",
    });
    expect(grants.seen[0].membership).toMatchObject({
      projectId: "p1",
      userId: "u2",
      rank: "contributor",
    });
    expect(grants.seen[0].requires).toEqual(["quest:create"]);
  });

  it("still refuses a non-member before the provider is consulted", async ({
    expect,
  }) => {
    const { alepha, app } = createApp({ ranks: true, userId: "stranger" });
    await alepha.start();
    await seed(app, "contributor");

    await expect(
      app.createQuest.run({ params: { id: "p1" } }, { user: app.token() }),
    ).rejects.toThrow(ForbiddenError);

    const grants = alepha.inject(ResourceGrantsProvider) as RankGrantsProvider;
    expect(grants.seen).toHaveLength(0);
  });

  it("checks the permission at application scope too, from the same string", async ({
    expect,
  }) => {
    // No roles, so the placeholder realm grants nothing: the folded
    // `secure.permissions` refuses before the guard ever runs.
    const { alepha, app } = createApp({ ranks: true, roles: [] });
    await alepha.start();
    await seed(app, "contributor");

    await expect(
      app.createQuest.run({ params: { id: "p1" } }, { user: app.token() }),
    ).rejects.toThrow("Permission 'quest:create' required");

    const grants = alepha.inject(ResourceGrantsProvider) as RankGrantsProvider;
    expect(grants.seen).toHaveLength(0);
  });

  it("publishes the folded permission on the middleware options", async ({
    expect,
  }) => {
    const { alepha, app } = createApp();
    await alepha.start();

    // The chain `ServerLinksProvider` walks: it finds the middleware by name
    // and reads `options.permissions` off it, which is what reaches the
    // client's action registry and decides whether a write control renders.
    const secure = app.createQuest.middlewares.find(
      (m) => m?.name === "$secure",
    );

    expect(secure).toBeDefined();
    expect((secure?.options as any)?.permissions).toEqual(["quest:create"]);

    const unrequired = app.readProject.middlewares.find(
      (m) => m?.name === "$secure",
    );
    expect((unrequired?.options as any)?.permissions).toBeUndefined();
  });

  it("reads the membership row once across a fan-out, requires or not", async ({
    expect,
  }) => {
    const { alepha, app } = createApp({ ranks: true });
    await alepha.start();
    await seed(app, "owner");
    app.reset();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/fan-out-requires`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "p1" }),
      },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(["p1", "p1", "p1"]);

    // Exact counts, never an upper bound: an upper bound also passes when the
    // gate stops running at all.
    expect(app.counts()).toEqual({ projects: 1, members: 1 });
  });

  it("reads the membership row for an owner when a permission is required", async ({
    expect,
  }) => {
    const { alepha, app } = createApp({ ranks: true, userId: "u1" });
    await alepha.start();
    // `u1` created the project and holds NO membership row.
    await app.projects.create({ id: "p2", createdBy: "u1", title: "Beta" });
    app.reset();

    // Without `requires` the owner short-circuits before the join, which is
    // why the creator costs one read fewer than a plain member.
    await expect(
      app.ownerRead.run({ params: { id: "p2" } }, { user: app.token() }),
    ).resolves.toBe("p2");
    expect(app.counts()).toEqual({ projects: 1, members: 0 });

    app.reset();

    // With one, the join is read even for the owner: a permission set lives on
    // that row, and here there is none - so the provider sees `undefined` and
    // falls back to its lowest rank.
    await expect(
      app.ownerCreateQuest.run({ params: { id: "p2" } }, { user: app.token() }),
    ).rejects.toThrow("Your rank (viewer) does not grant quest:create");
    expect(app.counts()).toEqual({ projects: 1, members: 1 });
  });

  it("accepts a via-only gate and refuses one with neither owner nor via", async ({
    expect,
  }) => {
    const { alepha, app } = createApp({ ranks: true });
    await alepha.start();
    await seed(app, "contributor");

    // via-only: no `owner`, and the creator is a stranger here.
    await expect(
      app.readProject.run({ params: { id: "p1" } }, { user: app.token() }),
    ).resolves.toBe("p1");

    expect(() =>
      $owns({
        repository: () => app.projects as unknown as Repository<any>,
        param: "id",
      } as never),
    ).toThrow(AlephaError);
  });
});
