import { $inject, Alepha, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";
import {
  $entity,
  $repository,
  pg,
  type TransactionContext,
} from "../../src/orm";
import { DbVersionMismatchError } from "../../src/orm/errors/DbVersionMismatchError.ts";

class A {
  dt = $inject(DateTimeProvider);

  repository = $repository(
    $entity({
      name: "a",
      schema: t.object({
        id: pg.primaryKey(),
        counter: t.integer(),
        __v: pg.version(),
      }),
    }),
  );

  incFn = async (
    id: number,
    val: number,
    waitMs = 0,
    tx?: TransactionContext,
  ) => {
    const { counter } = await this.repository.findById(id, {
      tx,
    });

    if (waitMs) {
      await this.dt.wait(waitMs);
    }

    return await this.repository.updateById(
      id,
      {
        counter: counter + val,
      },
      { tx },
    );
  };
}

describe("version", () => {
  it("should detect version mismatch on concurrent updates", async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(A);
    await alepha.start();

    const { id } = await app.repository.create({ counter: 0 });
    const r1 = await app.repository.findById(id);
    const r2 = await app.repository.findById(id);

    r1.counter += 1;
    r2.counter += 1;

    await app.repository.save(r1);

    await expect(() => app.repository.save(r2)).rejects.toThrow(
      new DbVersionMismatchError("a", id),
    );
  });
});
