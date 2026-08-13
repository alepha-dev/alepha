import { Alepha, z } from "alepha";
import { currentTenantAtom, currentUserAtom } from "alepha/security";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

/**
 * `opts.cache` is a performance knob. It must never widen what a read can see:
 * the cache key has to carry the predicate the repository ADDS (tenant scope,
 * soft-delete filter), not just the one the caller wrote.
 */

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

const docs = $entity({
  name: "query_cache_docs",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    organization: db.organization(),
    title: z.text(),
  }),
});

const softDocs = $entity({
  name: "query_cache_soft_docs",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    deletedAt: db.deletedAt(),
    title: z.text(),
  }),
});

class TenantApp {
  docs = $repository(docs);
}

class SoftApp {
  docs = $repository(softDocs);
}

const boot = <T extends object>(service: new () => T) => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const app = alepha.inject(service);
  return { alepha, app };
};

const asOrg = <R>(alepha: Alepha, org: string, fn: () => Promise<R>) =>
  alepha.context.run(() => {
    alepha.store.set(currentUserAtom, {
      id: `user-${org}`,
      realm: "default",
      roles: [],
      organization: org,
    });
    return fn();
  });

describe("query cache is tenant-scoped", () => {
  it("should not serve one organization's cached rows to another", async () => {
    const { alepha, app } = boot(TenantApp);
    await alepha.start();

    await asOrg(alepha, ORG_A, () => app.docs.create({ title: "secret-A" }));
    await asOrg(alepha, ORG_B, () => app.docs.create({ title: "secret-B" }));

    const a = await asOrg(alepha, ORG_A, () =>
      app.docs.findMany({ orderBy: "id" }, { cache: { ttl: 60_000 } }),
    );
    const b = await asOrg(alepha, ORG_B, () =>
      app.docs.findMany({ orderBy: "id" }, { cache: { ttl: 60_000 } }),
    );

    expect(a.map((it) => it.title)).toEqual(["secret-A"]);
    expect(b.map((it) => it.title)).toEqual(["secret-B"]);
  });

  it("should not serve a host-resolved tenant's cached rows to another", async () => {
    const { alepha, app } = boot(TenantApp);
    await alepha.start();

    const asTenant = <R>(id: string, fn: () => Promise<R>) =>
      alepha.context.run(() => {
        alepha.store.set(currentTenantAtom, { id });
        return fn();
      });

    await asTenant(ORG_A, () => app.docs.create({ title: "tenant-A" }));
    await asTenant(ORG_B, () => app.docs.create({ title: "tenant-B" }));

    const a = await asTenant(ORG_A, () =>
      app.docs.findMany({ orderBy: "id" }, { cache: { ttl: 60_000 } }),
    );
    const b = await asTenant(ORG_B, () =>
      app.docs.findMany({ orderBy: "id" }, { cache: { ttl: 60_000 } }),
    );

    expect(a.map((it) => it.title)).toEqual(["tenant-A"]);
    expect(b.map((it) => it.title)).toEqual(["tenant-B"]);
  });

  it("should still hit the cache for two reads in the same tenant", async () => {
    const { alepha, app } = boot(TenantApp);
    await alepha.start();

    await asOrg(alepha, ORG_A, () => app.docs.create({ title: "first" }));

    const first = await asOrg(alepha, ORG_A, () =>
      app.docs.findMany({ orderBy: "id" }, { cache: { ttl: 60_000 } }),
    );

    // A direct write that bypasses invalidation would still be masked by a
    // live cache entry — which is exactly what "cache hit" means here.
    const second = await asOrg(alepha, ORG_A, () =>
      app.docs.findMany({ orderBy: "id" }, { cache: { ttl: 60_000 } }),
    );

    expect(second).toBe(first);
  });
});

describe("query cache honours opts.force", () => {
  it("should not let a force:true read poison a normal read", async () => {
    const { alepha, app } = boot(SoftApp);
    await alepha.start();

    const row = await app.docs.create({ title: "gone" });
    await app.docs.deleteById(row.id as number);

    const forced = await app.docs.findMany(
      {},
      { force: true, cache: { ttl: 60_000 } },
    );
    const normal = await app.docs.findMany({}, { cache: { ttl: 60_000 } });

    expect(forced.map((it) => it.title)).toEqual(["gone"]);
    expect(normal).toEqual([]);
  });
});
