import { Alepha, type Static } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";
import { bigEntity } from "../__tests__/fixtures/bigEntitySchema.ts";
import type { InsertUserEntity } from "../__tests__/fixtures/userEntitySchema.ts";
import { userEntity } from "../__tests__/fixtures/userEntitySchema.ts";
import { $repository } from "../index.ts";

class App {
  users = $repository(userEntity);
  big = $repository(bigEntity);
  create = (data: InsertUserEntity) => this.users.create(data);
}

const testPgAttr = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const entity = await app.users.create({
    suspect: "hey",
    name: "John",
    profile: {
      age: 30,
    },
  } as any);

  expect((entity as any).suspect).toBeUndefined();
  expect(entity.name).toEqual("John");
  expect(entity.profile.age).toEqual(30);
};

describe("$repository - pg.attr", () => {
  it("should filter out attributes not defined in schema", async () => {
    await testPgAttr(Alepha.create());
  });

  it("should filter out attributes not defined in schema (sqlite)", async () => {
    await testPgAttr(
      Alepha.create({
        env: {
          DATABASE_URL: "sqlite://:memory:",
        },
      }),
    );
  });
});

const testAllTypes = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const data: Static<typeof bigEntity.insertSchema> = {
    type: "big_entity",
    a: "a",
    b: 1.111,
    date: "2024-01-01",
    c: 2,
    d: true,
    e: {
      a: "a",
      b: 1,
      c: 2,
      d: true,
      e: {
        a: "a",
        b: 1,
        c: 2,
        d: true,
        j: [
          {
            a: "a",
            b: 1,
            c: 2,
            d: true,
            e: {
              a: "a",
              b: 1,
              c: 2,
              d: true,
            },
          },
        ],
      },
    },
    f: ["a", "b"],
    g: [1.111],
    h: [2, 1],
    i: [true],
    j: [
      {
        a: "a",
        b: 1,
        c: 2,
        d: true,
        e: {
          a: "a",
          b: 1,
          c: 2,
          d: true,
        },
      },
    ],
    k: alepha.inject(DateTimeProvider).nowISOString(),
    l: "123e4567-e89b-12d3-a456-426614174000",
    m: "a" as const,
  };
  const entity = await app.big.create(data);

  expect(entity).toEqual({
    id: entity.id,
    ...data,
  });

  const it = await app.big.findMany({
    where: {
      type: "big_entity",
    },
  });

  expect(it).toHaveLength(1);
};

describe("$repository - all types", () => {
  it("should handle all supported data types", async () => {
    await testAllTypes(Alepha.create());
  });

  it("should handle all supported data types (sqlite)", async () => {
    await testAllTypes(
      Alepha.create({
        env: {
          DATABASE_URL: "sqlite://:memory:",
        },
      }),
    );
  });
});
