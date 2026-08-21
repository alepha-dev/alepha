import { Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { DbTimeoutError } from "../../../errors/DbTimeoutError.ts";
import { $entity } from "../../../primitives/$entity.ts";
import { $repository } from "../../../primitives/$repository.ts";
import { db } from "../../DatabaseTypeProvider.ts";
import { CloudflareD1Provider } from "../CloudflareD1Provider.ts";
import { DatabaseProvider } from "../DatabaseProvider.ts";
import { FakeD1 } from "./fakeD1.ts";

/**
 * The budget wired end to end: a query issued through the repository layer
 * reaches the binding through drizzle, and the ceiling has to hold there
 * rather than only on the wrapper's own unit tests.
 *
 * `ALEPHA_SERVERLESS` is set throughout because that is the deployed shape:
 * it is also what makes the provider skip migrations at boot, exactly as a
 * Worker does.
 */
const boot = async (env: Record<string, unknown> = {}) => {
  const binding = new FakeD1();
  const alepha = Alepha.create({
    env: { DATABASE_URL: "d1://DB", ALEPHA_SERVERLESS: true, ...env },
  }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });

  alepha.store.set("cloudflare.env", { DB: binding });
  await alepha.start();

  const time = alepha.inject(DateTimeProvider);
  time.pause();

  return { alepha, binding, time, provider: alepha.inject(DatabaseProvider) };
};

describe("CloudflareD1Provider timeout", () => {
  it("bounds a stalled query by default on serverless", async () => {
    const { binding, time, provider } = await boot();
    binding.stalling = true;

    const pending = provider.execute("select 1" as never);
    const settled = await expect(pending).rejects.toThrow(/timed out/i);

    await time.travel([6, "seconds"]);
    await settled;
  });

  it("honours an explicit DATABASE_TIMEOUT", async () => {
    const { binding, time, provider } = await boot({ DATABASE_TIMEOUT: 1000 });
    binding.stalling = true;

    const pending = provider.execute("select 1" as never);
    const settled = await expect(pending).rejects.toThrow(/timed out/i);

    // Only 2s of travel: the default 5s budget would still be pending here,
    // so this fails if the configured value is ignored.
    await time.travel([2, "seconds"]);
    await settled;
  });

  it("leaves queries unbounded when DATABASE_TIMEOUT is 0", async () => {
    const { binding, time, provider } = await boot({ DATABASE_TIMEOUT: 0 });
    binding.stalling = true;

    let settled = false;
    void provider.execute("select 1" as never).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await time.travel([60, "seconds"]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(settled).toBe(false);
  });

  it("still answers normally when the database is healthy", async () => {
    const { provider } = await boot();

    await expect(provider.execute("select 1" as never)).resolves.toEqual([]);
  });

  it("surfaces a timeout as a retryable 503 through the repository", async () => {
    const quests = $entity({
      name: "timeout_probe_quests",
      schema: z.object({
        id: db.primaryKey(z.integer()),
        title: z.text(),
      }),
    });

    class App {
      quests = $repository(quests);
    }

    const binding = new FakeD1();
    const alepha = Alepha.create({
      env: { DATABASE_URL: "d1://DB", ALEPHA_SERVERLESS: true },
    }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });
    alepha.store.set("cloudflare.env", { DB: binding });

    const app = alepha.inject(App);
    await alepha.start();

    const time = alepha.inject(DateTimeProvider);
    time.pause();
    binding.stalling = true;

    const pending = app.quests.findMany();

    // The repository path is the one production uses, and it is where the
    // ceiling nearly went unnoticed: drizzle catches the driver error and
    // rethrows `Failed query: ...` with the timeout demoted to `cause`, so
    // an unclassified timeout reaches the browser as a 500 that reads like a
    // broken statement instead of "busy, try again".
    const settled = pending.then(
      () => {
        throw new AlephaError("expected the query to be abandoned");
      },
      (error: unknown) => {
        expect(DbTimeoutError.from(error)).toBeInstanceOf(DbTimeoutError);
        expect((error as DbTimeoutError).status).toBe(503);
      },
    );

    await time.travel([6, "seconds"]);
    await settled;
  });
});
