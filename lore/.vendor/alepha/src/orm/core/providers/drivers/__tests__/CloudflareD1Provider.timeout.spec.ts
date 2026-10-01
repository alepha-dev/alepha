import { Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { DbTimeoutError } from "../../../errors/DbTimeoutError.ts";
import { $entity } from "../../../primitives/$entity.ts";
import { $repository } from "../../../primitives/$repository.ts";
import { db } from "../../DatabaseTypeProvider.ts";
import { CloudflareD1Provider } from "../CloudflareD1Provider.ts";
import { D1TimeoutProvider } from "../D1TimeoutProvider.ts";
import { DatabaseProvider } from "../DatabaseProvider.ts";
import { FakeD1, FakeStatement } from "./fakeD1.ts";

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
    // The assertion is attached BEFORE the clock moves, on purpose: `pending`
    // rejects during the `travel()` below, and with no handler attached yet
    // that surfaces as an unhandled rejection. It is awaited two lines down.
    // oxlint-disable-next-line vitest/valid-expect
    const settled = expect(pending).rejects.toThrow(/timed out/i);

    await time.travel([6, "seconds"]);
    await settled;
  });

  it("honours an explicit DATABASE_TIMEOUT", async () => {
    const { binding, time, provider } = await boot({ DATABASE_TIMEOUT: 1000 });
    binding.stalling = true;

    const pending = provider.execute("select 1" as never);
    // The assertion is attached BEFORE the clock moves, on purpose: `pending`
    // rejects during the `travel()` below, and with no handler attached yet
    // that surfaces as an unhandled rejection. It is awaited two lines down.
    // oxlint-disable-next-line vitest/valid-expect
    const settled = expect(pending).rejects.toThrow(/timed out/i);

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

/**
 * `batch` is the one entry point that takes statements back IN, and so the
 * one place the wrapper can hand the binding something the binding did not
 * make. Drizzle reaches it by building every statement through
 * `client.prepare(...).bind(...)` and passing the array straight to
 * `client.batch(...)`, so with the ceiling on, every one of those is a
 * wrapper.
 */
describe("D1TimeoutProvider batch", () => {
  const wrap = async (options?: { applyTo: "all" | "reads" }) => {
    const alepha = Alepha.create();
    const timeouts = alepha.inject(D1TimeoutProvider);
    await alepha.start();

    const binding = new FakeD1();
    return {
      binding,
      wrapped: timeouts.wrap(binding, [5, "seconds"], options),
    };
  };

  it("hands the binding its own statements, carrying their bound values", async () => {
    const { binding, wrapped } = await wrap();

    await wrapped.batch([
      wrapped.prepare("insert into t (id) values (?)").bind(1),
      wrapped.prepare("insert into t (id) values (?)").bind(2),
    ]);

    expect(binding.batched).toHaveLength(1);
    // The bound values, not just the count: a fix that unwrapped to the
    // statement `prepare` returned would lose everything `bind` added.
    expect(
      binding.batched[0].map((statement) => (statement as FakeStatement).bound),
    ).toEqual([[1], [2]]);
  });

  it("unwraps under 'reads' too, where the batch itself stays unbounded", async () => {
    const { binding, wrapped } = await wrap({ applyTo: "reads" });

    // A SELECT is wrapped even under `reads`, so the early return that leaves
    // the batch unbounded still receives wrappers and still has to unwrap.
    await wrapped.batch([wrapped.prepare("select id from t").bind(7)]);

    expect(
      binding.batched[0].map((statement) => (statement as FakeStatement).bound),
    ).toEqual([[7]]);
  });
});
