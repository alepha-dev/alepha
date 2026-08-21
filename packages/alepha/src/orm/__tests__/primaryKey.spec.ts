import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { DbError } from "../core/errors/DbError.ts";
import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const uuidTimestamp = (id: unknown): number =>
  Number.parseInt(String(id).slice(0, 8) + String(id).slice(9, 13), 16);

const testDefaultPrimaryKeyIsUuidV7 = async (alepha: Alepha) => {
  class App {
    notes = $repository(
      $entity({
        name: "pk_default_v7",
        schema: z.object({
          id: db.primaryKey(),
          label: z.text(),
        }),
      }),
    );
  }

  const app = alepha.inject(App);
  await alepha.start();

  const dateTime = alepha.inject(DateTimeProvider);
  dateTime.pause();
  // Far from the wall clock on purpose: ids must follow the app clock, not
  // any database-side default evaluated with the real time.
  await dateTime.travel(1_000_000_000);

  const first = await app.notes.create({ label: "first" });
  const second = await app.notes.create({ label: "second" });

  expect(String(first.id)).toMatch(UUID_V7_PATTERN);
  expect(uuidTimestamp(first.id)).toBe(dateTime.nowMillis());
  expect(String(second.id) > String(first.id)).toBe(true);

  expect(await app.notes.getById(first.id)).toEqual(first);
};

const testUuidPrimaryKeyGeneratesV7 = async (alepha: Alepha) => {
  class App {
    tags = $repository(
      $entity({
        name: "pk_uuid_v7",
        schema: z.object({
          id: db.primaryKey(z.uuid()),
          label: z.text(),
        }),
      }),
    );
  }

  const app = alepha.inject(App);
  await alepha.start();

  const dateTime = alepha.inject(DateTimeProvider);
  dateTime.pause();
  await dateTime.travel(1_000_000_000);

  const tag = await app.tags.create({ label: "tagged" });

  expect(tag.id).toMatch(UUID_V7_PATTERN);
  expect(uuidTimestamp(tag.id)).toBe(dateTime.nowMillis());
};

describe("primaryKey", () => {
  it("should default to an app-generated uuid v7 (sqlite)", async () => {
    await testDefaultPrimaryKeyIsUuidV7(sqlite());
  });

  it("should default to an app-generated uuid v7 (postgres)", async () => {
    await testDefaultPrimaryKeyIsUuidV7(postgres());
  });

  it("should generate uuid v7 for explicit uuid primary keys (sqlite)", async () => {
    await testUuidPrimaryKeyGeneratesV7(sqlite());
  });

  it("should generate uuid v7 for explicit uuid primary keys (postgres)", async () => {
    await testUuidPrimaryKeyGeneratesV7(postgres());
  });
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
