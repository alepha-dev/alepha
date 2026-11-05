import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { DbError } from "../../../errors/DbError.ts";
import { DbResultTooLargeError } from "../../../errors/DbResultTooLargeError.ts";
import { $entity } from "../../../primitives/$entity.ts";
import { $repository } from "../../../primitives/$repository.ts";
import { db } from "../../DatabaseTypeProvider.ts";
import { CloudflareD1Provider } from "../CloudflareD1Provider.ts";
import { DatabaseProvider } from "../DatabaseProvider.ts";
import { FakeD1 } from "./fakeD1.ts";

/**
 * The text Cloudflare publishes for the 50 MB result cap (2026-11-04), bare
 * and as the binding may prefix it.
 */
const BARE =
  "D1 query result exceeded the maximum response size limit of 50 MB";
const PREFIXED = `D1_ERROR: ${BARE}`;

const probes = $entity({
  name: "result_cap_probes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    body: z.text(),
  }),
});

class App {
  probes = $repository(probes);
}

const boot = async (message: string) => {
  const binding = new FakeD1(async () => {
    throw new Error(message);
  });
  const alepha = Alepha.create({
    env: { DATABASE_URL: "d1://DB", ALEPHA_SERVERLESS: true },
  }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });
  alepha.store.set("cloudflare.env", { DB: binding });

  const app = alepha.inject(App);
  await alepha.start();

  return { app, provider: alepha.inject(DatabaseProvider) };
};

describe("CloudflareD1Provider result cap", () => {
  for (const [label, message] of [
    ["bare", BARE],
    ["prefixed", PREFIXED],
  ] as const) {
    describe(`with the ${label} message`, () => {
      it("raises DbResultTooLargeError from a raw execute, naming the statement", async () => {
        const { provider } = await boot(message);

        const error = await provider
          .execute("select body from result_cap_probes")
          .then(
            () => expect.fail("should have thrown"),
            (e: unknown) => e,
          );

        expect(error).toBeInstanceOf(DbResultTooLargeError);
        expect((error as DbResultTooLargeError).status).toBe(500);
        expect((error as Error).message).toContain(
          "select body from result_cap_probes",
        );
      });

      it("raises DbResultTooLargeError through the repository, without the parameters", async () => {
        const { app } = await boot(message);

        const error = await app.probes
          .findMany({ where: { body: { eq: "someone@example.com" } } })
          .then(
            () => expect.fail("should have thrown"),
            (e: unknown) => e,
          );

        // drizzle wraps the driver error in `Failed query: ...` and demotes
        // it to `cause`: the classification has to see through that.
        expect(error).toBeInstanceOf(DbError);
        expect(error).toBeInstanceOf(DbResultTooLargeError);
        expect((error as DbResultTooLargeError).status).toBe(500);
        expect((error as Error).message).toMatch(/result_cap_probes/);
        expect((error as Error).message).not.toContain("someone@example.com");
        expect(DbResultTooLargeError.find(error)).toBe(error);
      });
    });
  }

  it("leaves an unrelated driver error alone", async () => {
    const { provider } = await boot("D1_ERROR: no such table: nope");

    await expect(
      provider.execute("select 1 from nope"),
    ).rejects.not.toBeInstanceOf(DbResultTooLargeError);
  });
});
