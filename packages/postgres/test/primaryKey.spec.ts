import { Alepha, t } from "@alepha/core";
import { describe, expect, it } from "vitest";
import { $entity, $repository, pg } from "../src";
import { PgError } from "../src/errors/PgError.ts";

describe("primaryKey", () => {
  it("should handle identity primary key with overflow", async () => {
    class App {
      identity = $repository(
        $entity({
          name: "identity",
          schema: t.object({
            id: pg.identityPrimaryKey({
              mode: "always",
              minValue: 2147483646,
            }),
          }),
        }),
      );
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.identity.create({})).toEqual({
      id: 2147483646,
    });

    await app.identity.create({});

    await expect(() => app.identity.create({})).rejects.toThrowError(PgError);
  });

  it("should handle big identity primary key without overflow", async () => {
    class App {
      big = $repository(
        $entity({
          name: "big",
          schema: t.object({
            id: pg.bigIdentityPrimaryKey({
              mode: "always",
              minValue: 2147483646,
            }),
          }),
        }),
      );
    }

    const alepha = Alepha.create();
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
          schema: t.object({
            id: pg.uuidPrimaryKey(),
          }),
        }),
      );
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.uuid.create({})).toEqual({
      id: expect.any(String),
    });
  });
});
