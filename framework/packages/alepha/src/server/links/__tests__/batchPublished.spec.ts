import { Alepha, z } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  $remote,
  AlephaServerLinks,
  type HttpClientLink,
  LinkProvider,
} from "../index.ts";

/**
 * A service only other services may call. `secret` answers with the
 * credentials it received.
 */
class Internal {
  secret = $action({
    path: "/secret",
    method: "GET",
    schema: { response: z.text() },
    handler: ({ headers }) =>
      `authorization=${headers.authorization ?? "none"} cookie=${headers.cookie ?? "none"}`,
  });
}

const env = { LOG_LEVEL: "error" as const };

const startInternal = async () => {
  const internal = Alepha.create({ env })
    .with(AlephaServerLinks)
    .with(Internal);
  await internal.start();
  return internal.inject(ServerProvider).hostname;
};

const startFront = async (front: new () => object) => {
  const alepha = Alepha.create({ env }).with(AlephaServerLinks).with(front);
  await alepha.start();
  return alepha.inject(ServerProvider).hostname;
};

const credentials = {
  authorization: "Bearer caller",
  cookie: "session=caller",
};

const batch = async (host: string, actions: string[]) => {
  const response = await fetch(`${host}/api/_batch`, {
    method: "POST",
    headers: { "content-type": "application/json", ...credentials },
    body: JSON.stringify(actions.map((action) => ({ action }))),
  });
  const entries: Array<Record<string, unknown>> = await response.json();
  // The request id differs per request and is not what these tests compare.
  return entries.map(({ requestId: _requestId, ...entry }) => entry);
};

describe("POST /api/_batch and $remote", () => {
  it("does not reach the actions of a $remote declared without proxy", async ({
    expect,
  }) => {
    const internalUrl = await startInternal();
    class Front {
      svc = $remote({ url: internalUrl });
      ping = $action({
        path: "/ping",
        method: "GET",
        schema: { response: z.text() },
        handler: () => "pong",
      });
    }
    const front = await startFront(Front);

    // What a direct call can reach: the registry lists `ping` alone, and
    // there is no route to the remote's action.
    const registry = await fetch(`${front}/api/_links`).then((it) => it.json());
    expect(Object.keys(registry.actions)).toEqual(["ping"]);
    expect((await fetch(`${front}/api/svc/secret`)).status).toBe(404);

    const [secret, unknown, ping] = await batch(front, [
      "secret",
      "noSuchAction",
      "ping",
    ]);

    // Answered exactly as a name that does not exist.
    expect(unknown.error).toBe("Action noSuchAction not found.");
    expect(secret).toStrictEqual({
      ...unknown,
      action: "secret",
      error: "Action secret not found.",
    });
    expect(secret.status).toBe(401);
    expect(secret.data).toBeUndefined();
    expect(ping).toStrictEqual({ action: "ping", status: 200, data: "pong" });
  });

  it("does not reach the actions of a $remote whose proxy is disabled", async ({
    expect,
  }) => {
    const internalUrl = await startInternal();
    class Front {
      svc = $remote({ url: internalUrl, proxy: { disabled: true } });
    }
    const front = await startFront(Front);

    const registry = await fetch(`${front}/api/_links`).then((it) => it.json());
    expect(registry.actions).toStrictEqual({});
    expect((await fetch(`${front}/api/svc/secret`)).status).toBe(404);

    const [secret] = await batch(front, ["secret"]);

    expect(secret.status).toBe(401);
    expect(secret.data).toBeUndefined();
  });

  it("forwards to a proxied $remote the credentials its proxy route forwards", async ({
    expect,
  }) => {
    const internalUrl = await startInternal();
    class Default {
      svc = $remote({ url: internalUrl, proxy: true });
    }
    class Nothing {
      svc = $remote({ url: internalUrl, proxy: { forward: [] } });
    }
    class Both {
      svc = $remote({
        url: internalUrl,
        proxy: { forward: ["cookie", "authorization"] },
      });
    }

    class Unset {
      svc = $remote({ url: internalUrl, proxy: { forward: undefined } });
    }

    for (const Front of [Default, Nothing, Both, Unset]) {
      const front = await startFront(Front);

      const direct = await fetch(`${front}/api/svc/secret`, {
        headers: credentials,
      }).then((it) => it.text());
      const [batched] = await batch(front, ["secret"]);

      expect(batched).toStrictEqual({
        action: "secret",
        status: 200,
        data: direct,
      });
    }

    // And the three differ, so the comparison above is not vacuous.
    const seen = async (Front: new () => object) =>
      (await batch(await startFront(Front), ["secret"]))[0].data;
    expect(await seen(Default)).toBe("authorization=Bearer caller cookie=none");
    expect(await seen(Nothing)).toBe("authorization=none cookie=none");
    expect(await seen(Both)).toBe(
      "authorization=Bearer caller cookie=session=caller",
    );
    expect(await seen(Unset)).toBe("authorization=Bearer caller cookie=none");
  });

  it("answers with the local action when a remote exposes one of the same name", async ({
    expect,
  }) => {
    const internalUrl = await startInternal();
    for (const proxy of [false, true]) {
      class Front {
        svc = $remote({ url: internalUrl, proxy });
        secret = $action({
          path: "/secret",
          method: "GET",
          schema: { response: z.text() },
          handler: () => "local",
        });
      }
      const alepha = Alepha.create({ env }).with(AlephaServerLinks).with(Front);
      await alepha.start();
      const front = alepha.inject(ServerProvider).hostname;

      const [secret] = await batch(front, ["secret"]);
      const called = await alepha.context.run(() =>
        alepha.inject(LinkProvider).follow("secret"),
      );

      expect(secret).toStrictEqual({
        action: "secret",
        status: 200,
        data: "local",
      });
      expect(called).toBe("local");
    }
  });
});

describe("LinkProvider.registerLink", () => {
  const local: HttpClientLink = {
    name: "secret",
    path: "/secret",
    handler: () => "local",
  };
  const remote: HttpClientLink = {
    name: "secret",
    path: "/secret",
    host: "http://internal.example.app",
    service: "svc",
  };

  it("keeps a local action over a remote one of the same name, in both orders", ({
    expect,
  }) => {
    for (const order of [
      [local, remote],
      [remote, local],
    ]) {
      const links = Alepha.create().inject(LinkProvider);

      for (const link of order) {
        links.registerLink(link);
      }

      expect(links.getServerLinks()).toStrictEqual([local]);
    }
  });
});
