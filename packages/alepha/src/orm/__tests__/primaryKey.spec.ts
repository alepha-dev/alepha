import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { DbError } from "../core/errors/DbError.ts";
import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

describe("primaryKey", () => {
  it("should handle identity primary key with overflow", async () => {
    class App {
      identity = $repository(
        $entity({
          name: "identity",
          schema: z.object({
            id: db.identityPrimaryKey({
              mode: "always",
              minValue: 2147483646,
            }),
          }),
        }),
      );
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.identity.create({})).toEqual({
      id: 2147483646,
    });

    await app.identity.create({});

    await expect(() => app.identity.create({})).rejects.toThrowError(DbError);
  });

  it("should handle big identity primary key without overflow", async () => {
    class App {
      big = $repository(
        $entity({
          name: "big",
          schema: z.object({
            id: db.bigIdentityPrimaryKey({
              mode: "always",
              minValue: 2147483646,
            }),
          }),
        }),
      );
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.big.create({})).toEqual({
      id: 2147483646,
    });

    expect(await app.big.create({})).toEqual({
      id: 2147483647,
    });

    expect(await app.big.create({})).toEqual({
      id: 2147483648,
    });
  });

  it("should handle uuid primary key", async () => {
    class App {
      uuid = $repository(
        $entity({
          name: "uuid",
          schema: z.object({
            id: db.uuidPrimaryKey(),
          }),
        }),
      );
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.uuid.create({})).toEqual({
      id: expect.any(String),
    });
  });
});
