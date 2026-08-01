import { $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { describe, expect, it } from "vitest";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import { $owns, $secure } from "../index.ts";

/**
 * A `$secure` guard runs real code — `$owns` loads a row through a repository.
 * Anything it calls must see the authenticated identity, otherwise
 * tenant-scoped reads inside the guard resolve no tenant: a non-strict entity
 * is read unscoped, and a strict one refuses outright.
 *
 * The user therefore has to be published to the store BEFORE the guard runs,
 * not after — and the behaviour must not differ between transports.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

const docs = $entity({
  name: "guard_ctx_docs",
  schema: z.object({
    id: db.primaryKey(z.text()),
    organization: db.organization({ strict: true }),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const USER = {
  id: "u1",
  realm: "default",
  roles: [] as string[],
  organization: ORG,
};

class Service {
  docs = $repository(docs);

  read = $pipeline({
    use: [
      $owns({ repository: () => this.docs, param: "id", owner: "createdBy" }),
    ],
    handler: async () => "ok",
  });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const svc = alepha.inject(Service);
  await alepha.start();

  await alepha.context.run(async () => {
    alepha.store.set(currentUserAtom, USER);
    await svc.docs.create({ id: "d1", createdBy: "u1", title: "t" });
  });

  return { alepha, svc };
};

describe("$secure publishes the user before running the guard", () => {
  it("should expose the user to the guard when it arrived on the HTTP request", async () => {
    const alepha = Alepha.create();
    const seen: Array<string> = [];

    class App {
      fn = $pipeline({
        use: [
          $secure({
            guard: () => {
              seen.push(
                alepha.store.get(currentUserAtom) ? "present" : "missing",
              );
              return true;
            },
          }),
        ],
        handler: async () => "ok",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    await alepha.context.run(async () => {
      alepha.store.set("alepha.http.request", {
        user: USER,
        params: {},
        query: {},
        // biome-ignore lint/suspicious/noExplicitAny: minimal request stub
      } as any);
      await app.fn();
    });

    expect(seen).toEqual(["present"]);
  });

  it("should let $owns read a strict tenant entity over HTTP", async () => {
    const { alepha, svc } = await boot();

    const result = await alepha.context.run(async () => {
      alepha.store.set("alepha.http.request", {
        user: USER,
        params: { id: "d1" },
        query: {},
        // biome-ignore lint/suspicious/noExplicitAny: minimal request stub
      } as any);
      return svc.read();
    });

    expect(result).toBe("ok");
  });

  it("should behave identically when the user arrives through the atom", async () => {
    const { alepha, svc } = await boot();

    const result = await alepha.context.run(async () => {
      alepha.store.set(currentUserAtom, USER);
      alepha.store.set("alepha.action.request", {
        params: { id: "d1" },
        query: {},
        // biome-ignore lint/suspicious/noExplicitAny: minimal request stub
      } as any);
      return svc.read();
    });

    expect(result).toBe("ok");
  });
});
