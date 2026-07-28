import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * Identifier lookups were written with `ilike`, which is a PATTERN match: `_`
 * matches any single character and `%` any run of them. A raw user-supplied
 * value therefore acted as a wildcard expression — `admi_` matched `admin`.
 * `eqInsensitive` is equality with case folding and no metacharacters.
 */
const people = $entity({
  name: "test_eqi_people",
  schema: z.object({
    id: db.primaryKey(),
    handle: z.text(),
  }),
});

class App {
  people = $repository(people);
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(
    AlephaOrmPostgres,
  );
  const app = alepha.inject(App);
  await alepha.start();
  await app.people.createMany([
    { handle: "admin" },
    { handle: "admix" },
    { handle: "AdMiN2" },
    { handle: "100%sure" },
    { handle: "under_score" },
  ]);
  return { alepha, app };
};

describe("eqInsensitive", () => {
  it("matches ignoring case", async () => {
    const { alepha, app } = await setup();

    const rows = await app.people.findMany({
      where: { handle: { eqInsensitive: "ADMIN" } },
    });
    expect(rows.map((r) => r.handle)).toEqual(["admin"]);

    await alepha.stop();
  });

  it("does not treat `_` as a single-character wildcard", async () => {
    const { alepha, app } = await setup();

    // `ilike: "admi_"` matches both `admin` and `admix`.
    const rows = await app.people.findMany({
      where: { handle: { eqInsensitive: "admi_" } },
    });
    expect(rows).toHaveLength(0);

    await alepha.stop();
  });

  it("does not treat `%` as a multi-character wildcard", async () => {
    const { alepha, app } = await setup();

    const rows = await app.people.findMany({
      where: { handle: { eqInsensitive: "admi%" } },
    });
    expect(rows).toHaveLength(0);

    await alepha.stop();
  });

  it("matches a value that itself contains LIKE metacharacters", async () => {
    const { alepha, app } = await setup();

    // The literal string "100%sure" must be findable by its own name.
    expect(
      await app.people.findMany({
        where: { handle: { eqInsensitive: "100%SURE" } },
      }),
    ).toHaveLength(1);

    expect(
      await app.people.findMany({
        where: { handle: { eqInsensitive: "UNDER_SCORE" } },
      }),
    ).toHaveLength(1);

    await alepha.stop();
  });

  it("still shows the ilike wildcard behaviour it replaces", async () => {
    const { alepha, app } = await setup();

    // Documents WHY the operator exists: this is what the auth path did.
    const wild = await app.people.findMany({
      where: { handle: { ilike: "admi_" } },
    });
    expect(wild.length).toBeGreaterThan(1);

    await alepha.stop();
  });
});
