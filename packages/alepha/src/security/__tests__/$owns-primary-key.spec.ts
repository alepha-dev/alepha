import { $inject, $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { ForbiddenError } from "alepha/server";
import { describe, expect, it } from "vitest";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $owns } from "../primitives/$owns.ts";
import { OwnedResourceProvider } from "../providers/OwnedResourceProvider.ts";

/**
 * `$owns` accepts any repository, so it must resolve the primary key the way
 * the repository does — not assume the column is called `id`.
 */

const docs = $entity({
  name: "owns_pk_docs",
  schema: z.object({
    docId: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const counters = $entity({
  name: "owns_pk_counters",
  schema: z.object({
    counterId: db.primaryKey(z.integer()),
    createdBy: z.text(),
  }),
});

const owner: UserAccountToken = { id: "u1", realm: "default", roles: [] };
const stranger: UserAccountToken = { id: "u2", realm: "default", roles: [] };

class Service {
  docs = $repository(docs);
  counters = $repository(counters);
  owned = $inject(OwnedResourceProvider);

  readDoc = $pipeline({
    use: [
      $owns({ repository: () => this.docs, param: "id", owner: "createdBy" }),
    ],
    handler: async () => this.owned.get<{ title: string }>().title,
  });

  readCounter = $pipeline({
    use: [
      $owns({
        repository: () => this.counters,
        param: "id",
        owner: "createdBy",
      }),
    ],
    handler: async () => "ok",
  });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const svc = alepha.inject(Service);
  await alepha.start();
  await svc.docs.create({ docId: "d1", createdBy: "u1", title: "hello" });
  await svc.counters.create({ createdBy: "u1" });
  return { alepha, svc };
};

const as = <R>(
  alepha: Alepha,
  user: UserAccountToken,
  id: string,
  fn: () => Promise<R>,
) =>
  alepha.context.run(() => {
    alepha.store.set(currentUserAtom, user);
    // biome-ignore lint/suspicious/noExplicitAny: minimal request stub
    alepha.store.set("alepha.action.request", {
      params: { id },
      query: {},
    } as any);
    return fn();
  });

describe("$owns resolves the entity's own primary key", () => {
  it("should load a resource whose primary key is not named 'id'", async () => {
    const { alepha, svc } = await boot();
    expect(await as(alepha, owner, "d1", () => svc.readDoc())).toBe("hello");
  });

  it("should still deny a non-owner", async () => {
    const { alepha, svc } = await boot();
    await expect(
      as(alepha, stranger, "d1", () => svc.readDoc()),
    ).rejects.toThrow(ForbiddenError);
  });

  it("should coerce the route param to a numeric primary key", async () => {
    const { alepha, svc } = await boot();
    // No `cast` declared: the repository knows the key is an integer.
    expect(await as(alepha, owner, "1", () => svc.readCounter())).toBe("ok");
  });
});
