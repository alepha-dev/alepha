import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const counters = $entity({
  name: "test_upsert_set_counters",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    slug: z.text(),
    hits: z.integer(),
  }),
  constraints: [{ columns: ["slug"], unique: true }],
});

class App {
  repository = $repository(counters);
}

const testSetIsValidated = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.repository.create({ slug: "home", hits: 1 });

  // Every other write path validates and codec-encodes its payload; the
  // ON CONFLICT set clause skipped both, so a value of the wrong type went
  // straight to the driver.
  await expect(
    app.repository.upsert(
      { slug: "home", hits: 2 },
      { target: ["slug"], set: { hits: "not-a-number" as any } },
    ),
  ).rejects.toThrow();

  // The row is untouched.
  const [row] = await app.repository.findMany({ where: { slug: "home" } });
  expect(row.hits).toBe(1);
};

const testSetStillWorks = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.repository.create({ slug: "about", hits: 1 });

  const result = await app.repository.upsert(
    { slug: "about", hits: 99 },
    { target: ["slug"], set: { hits: 7 } },
  );

  expect(result.hits).toBe(7);
};

describe("upsert set clause", () => {
  it("should validate the set payload (sqlite)", async () => {
    await testSetIsValidated(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("should validate the set payload (postgres)", async () => {
    await testSetIsValidated(Alepha.create().with(AlephaOrmPostgres));
  });

  it("should still apply a valid set payload (sqlite)", async () => {
    await testSetStillWorks(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("should still apply a valid set payload (postgres)", async () => {
    await testSetStillWorks(Alepha.create().with(AlephaOrmPostgres));
  });
});
