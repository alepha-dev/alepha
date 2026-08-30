import { afterEach, describe, expect, it } from "bun:test";

import { Alepha, z } from "alepha";
import { $action, ServerProvider } from "alepha/server";

import {
  AlephaServerLinks,
  AlephaServerLinksClient,
  LinkProvider,
} from "../index.ts";

/**
 * The runtime half of decision 12: a remote `$client` is proved on Node by
 * `remoteIntegration.spec.ts`, and here on Bun.
 *
 * Not a duplicate of that suite. What differs between the runtimes is the
 * machinery underneath - `BunHttpServerProvider` serving, Bun's `fetch`
 * calling - and a smoke test is the right size for that. workerd is covered
 * by construction (no Node builtin is reached on this path) but is stated as
 * untested.
 */
describe("$client against a remote app, on Bun", () => {
  let server: Alepha;
  let consumer: Alepha;

  afterEach(async () => {
    await consumer?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  it("resolves a remote registry and calls through it", async () => {
    class Tide {
      height = $action({
        schema: { response: z.text() },
        handler: () => "high",
      });
    }

    server = Alepha.create({ env: { NODE_ENV: "test" } })
      .with(AlephaServerLinks)
      .with(Tide);
    await server.start();

    const hostname = server.inject(ServerProvider).hostname;

    consumer = Alepha.create({ env: { NODE_ENV: "test" } }).with(
      AlephaServerLinksClient,
    );
    await consumer.start();

    const links = consumer.inject(LinkProvider);
    expect(links.getServerLinks()).toHaveLength(0);

    expect(await links.client<Tide>({ hostname }).height()).toBe("high");
  });

  it("names the host when the registry cannot be fetched", async () => {
    class Tide {
      height = $action({
        schema: { response: z.text() },
        handler: () => "high",
      });
    }

    consumer = Alepha.create({ env: { NODE_ENV: "test" } }).with(
      AlephaServerLinksClient,
    );
    await consumer.start();

    const gone = consumer
      .inject(LinkProvider)
      .client<Tide>({ hostname: "http://127.0.0.1:1" });

    // Bun's fetch fails differently from Node's, so the wrapper that names the
    // host has to survive whatever it throws. Caught by hand rather than with
    // `.rejects`, whose bun:test signature oxlint reads as non-thenable.
    let caught: unknown;
    try {
      await gone.height();
    } catch (error) {
      caught = error;
    }

    expect(String(caught)).toContain(
      "Could not fetch the action registry of http://127.0.0.1:1/api/_links",
    );
  });
});
