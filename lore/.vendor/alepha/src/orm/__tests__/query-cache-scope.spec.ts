import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";

/**
 * `opts.cache` is a performance knob. It must never widen what a read can see:
 * the cache key has to carry the soft-delete predicate the repository adds,
 * not just the predicate the caller wrote.
 */

const softDocs = $entity({
  name: "query_cache_soft_docs",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    deletedAt: db.deletedAt(),
    title: z.text(),
  }),
});

class SoftApp {
  docs = $repository(softDocs);
}

const boot = <T extends object>(service: new () => T) => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const app = alepha.inject(service);
  return { alepha, app };
};

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
