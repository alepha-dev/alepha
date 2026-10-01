import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const events = $entity({
  name: "test_bigint_events",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    // External 64-bit id (snowflake shape) — NOT a primary key.
    externalId: z.bigint(),
  }),
});

class App {
  repository = $repository(events);
}

// 2^53 + 1: silently corrupts when round-tripped through a JS number.
const BEYOND_SAFE = "9007199254740993";

const testBigintRoundTrip = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.repository.create({ externalId: BEYOND_SAFE });

  const rows = await app.repository.findMany();
  expect(rows[0].externalId).toBe(BEYOND_SAFE);

  const found = await app.repository.findMany({
    where: { externalId: { eq: BEYOND_SAFE } },
  });
  expect(found).toHaveLength(1);
};

describe("bigint precision", () => {
  it("round-trips values beyond 2^53 (sqlite)", async () => {
    await testBigintRoundTrip(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("round-trips values beyond 2^53 (postgres)", async () => {
    await testBigintRoundTrip(Alepha.create().with(AlephaOrmPostgres));
  });
});
