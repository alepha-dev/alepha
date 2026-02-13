import { $inject, Alepha, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";
import { DbConflictError } from "../errors/DbConflictError.ts";
import { $entity, $repository, $transaction, pg } from "../index.ts";

const a = $entity({
  name: "a",
  schema: t.object({
    id: pg.primaryKey(
      t.integer(),
      {},
      {
        mode: "byDefault",
      },
    ),
    v: pg.version(),
    counter: t.integer(),
  }),
});

class App {
  dt = $inject(DateTimeProvider);

  repository = $repository(a);

  runIncrementTest = $transaction({
    handler: async (tx, id: number, val: number, waitMs = 0) => {
      const e = await this.repository.getById(id, {
        tx,
      });
      if (waitMs) {
        await this.dt.wait(waitMs);
      }
      e.counter += val;
      return await this.repository.save(e, { tx });
    },
  });

  runCollisionTest = $transaction({
    handler: async (tx) => {
      await this.repository.deleteMany({}, { tx });
      const { id } = await this.repository.create({ counter: 0 }, { tx });
      await this.repository.create({ counter: 0 }, { tx });
      await this.repository.create({ counter: 0, id: id }, { tx });
    },
  });
}

describe("$transaction", () => {
  it(
    "should handle version mismatch with retry",
    { timeout: 10000 },
    async () => {
      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const { id } = await app.repository.create({ counter: 0 });

      const tx = app.runIncrementTest.run(id, 10, 200);
      await app.runIncrementTest.run(id, 100);
      await tx;

      const r3 = await app.repository.getById(id);

      expect(r3.counter).toBe(110);
    },
  );

  it("should rollback on conflict error", { timeout: 10000 }, async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    await app.repository.create({ counter: 0 });

    await expect(() => app.runCollisionTest.run()).rejects.toThrow(
      DbConflictError,
    );

    expect(await app.repository.count()).toBe(1);
  });
});
