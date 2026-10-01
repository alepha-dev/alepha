import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import type { D1DatabaseSession } from "../../../interfaces/D1Database.ts";
import { CloudflareD1Provider } from "../CloudflareD1Provider.ts";
import { DatabaseProvider } from "../DatabaseProvider.ts";
import { FakeD1, FakeD1WithoutSessions } from "./fakeD1.ts";

/**
 * Read replication does nothing unless queries go through a session:
 * Cloudflare routes everything to the primary otherwise, whatever the
 * dashboard says. These tests pin down that the session is opened, reused for
 * the whole request, and never shared between requests.
 */
const boot = async (
  env: Record<string, unknown> = {},
  binding: FakeD1 = new FakeD1(),
) => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "d1://DB", ALEPHA_SERVERLESS: true, ...env },
  }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });

  alepha.store.set("cloudflare.env", { DB: binding });
  await alepha.start();

  return {
    alepha,
    binding,
    provider: alepha.inject(DatabaseProvider) as CloudflareD1Provider,
  };
};

describe("CloudflareD1Provider sessions", () => {
  it("goes straight to the primary by default", async () => {
    const { alepha, binding, provider } = await boot();

    await alepha.fork(async () => {
      await provider.execute("select 1" as never);
    });

    // Default is `primary`: opting an app into a different consistency model
    // is never something a framework upgrade should do quietly.
    expect(binding.sessions).toEqual([]);
  });

  it("routes queries through a session when enabled", async () => {
    const { alepha, binding, provider } = await boot({
      DATABASE_D1_MODE: "sessions",
    });

    await alepha.fork(async () => {
      await provider.execute("select 1" as never);
    });

    expect(binding.sessions).toHaveLength(1);
  });

  it("opens the first session unconstrained", async () => {
    const { alepha, binding, provider } = await boot({
      DATABASE_D1_MODE: "sessions",
    });

    await alepha.fork(async () => {
      await provider.execute("select 1" as never);
    });

    // With no bookmark to anchor at, any replica will do and the fastest one
    // is the point of the exercise. `first-primary` here would give up the
    // entire latency win on every first request.
    expect(binding.sessions).toEqual(["first-unconstrained"]);
  });

  it("anchors a session at an incoming bookmark", async () => {
    const { alepha, binding, provider } = await boot({
      DATABASE_D1_MODE: "sessions",
    });

    await alepha.fork(async () => {
      provider.openSession("bm-from-last-response");
      await provider.execute("select 1" as never);
    });

    // This is what makes a read after a write correct across two requests:
    // the replica must be at least as current as the write the caller just
    // made, and the bookmark is the only thing that says so.
    expect(binding.sessions).toEqual(["bm-from-last-response"]);
  });

  it("anchors at a bookmark the request layer left in the context", async () => {
    const { alepha, binding, provider } = await boot({
      DATABASE_D1_MODE: "sessions",
    });

    await alepha.fork(async () => {
      // How the HTTP layer hands a bookmark in without the ORM having to
      // know about cookies or headers: it drops it in the context and the
      // session picks it up when it opens itself on the first query. The ORM
      // never imports the server module, and this keeps it that way.
      alepha.store.set("alepha.orm.d1.bookmark", "bm-from-cookie", {
        skipEvents: true,
      });
      await provider.execute("select 1" as never);
    });

    expect(binding.sessions).toEqual(["bm-from-cookie"]);
  });

  it("records the session on a carrier so an outer scope can read the bookmark", async () => {
    const binding = new FakeD1();
    binding.bookmark = "bm-outer";
    const { alepha, provider } = await boot(
      { DATABASE_D1_MODE: "sessions" },
      binding,
    );

    const carrier: { session?: D1DatabaseSession } = {};

    await alepha.fork(async () => {
      alepha.store.set("alepha.orm.d1.carrier", carrier, { skipEvents: true });

      // A nested layer, which is what a request handler actually runs in
      // ($scope middleware, transactional()). `store.set` targets the
      // INNERMOST layer, so the session stored by `openSession` is invisible
      // from outside, so the worker entry read null and never set the cookie,
      // silently disabling cross-request consistency in production.
      //
      // Mutating a holder the outer scope already owns is how the framework
      // solves this elsewhere (see `alepha.orm.afterCommit`).
      await alepha.context.nest(async () => {
        await provider.execute("select 1" as never);
      });
    });

    expect(carrier.session?.getBookmark()).toBe("bm-outer");
  });

  it("reuses one session for every query in a request", async () => {
    const { alepha, binding, provider } = await boot({
      DATABASE_D1_MODE: "sessions",
    });

    await alepha.fork(async () => {
      await provider.execute("select 1" as never);
      await provider.execute("select 2" as never);
      await provider.execute("select 3" as never);
    });

    // One session per request, not per query: a fresh session per query
    // would drop the sequential-consistency guarantee between them, which is
    // the whole reason the Sessions API exists.
    expect(binding.sessions).toHaveLength(1);
  });

  it("does not share a session between requests", async () => {
    const { alepha, binding, provider } = await boot({
      DATABASE_D1_MODE: "sessions",
    });

    await alepha.fork(async () => {
      await provider.execute("select 1" as never);
    });
    await alepha.fork(async () => {
      await provider.execute("select 2" as never);
    });

    expect(binding.sessions).toHaveLength(2);
  });

  it("reports the bookmark so the caller can hand it back", async () => {
    const binding = new FakeD1();
    binding.bookmark = "bm-99";
    const { alepha, provider } = await boot(
      { DATABASE_D1_MODE: "sessions" },
      binding,
    );

    const bookmark = await alepha.fork(async () => {
      await provider.execute("select 1" as never);
      return provider.sessionBookmark();
    });

    expect(bookmark).toBe("bm-99");
  });

  it("reports no bookmark when sessions are off", async () => {
    const { alepha, provider } = await boot();

    const bookmark = await alepha.fork(async () => {
      await provider.execute("select 1" as never);
      return provider.sessionBookmark();
    });

    expect(bookmark).toBeNull();
  });

  it("falls back to the primary when the runtime has no withSession", async () => {
    const binding = new FakeD1WithoutSessions();
    const { alepha, provider } = await boot(
      { DATABASE_D1_MODE: "sessions" },
      binding,
    );

    // An older `workerd` has no Sessions API. Degrading to the primary keeps
    // the app serving; throwing would turn a missing optimisation into an
    // outage.
    await alepha.fork(async () => {
      await expect(provider.execute("select 1" as never)).resolves.toEqual([]);
    });

    expect(binding.sessions).toEqual([]);
  });
});
