import { request as httpRequest } from "node:http";

import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { AlephaDevtoolsServer } from "../server/index.ts";

/**
 * A raw request, so the spec controls `Host` and `Origin` the way an attacker's
 * page (or a rebinding resolver) would. `fetch` will not set `Host`.
 */
const send = (
  port: number,
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<{ status: number; headers: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("the devtools server's Host and Origin checks", () => {
  const apps: Alepha[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.stop();
  });

  const setup = async () => {
    const alepha = Alepha.create({
      env: { SERVER_HOST: "127.0.0.1", SERVER_PORT: 0 },
    }).with(AlephaDevtoolsServer);
    await alepha.start();
    apps.push(alepha);
    const port = Number(new URL(alepha.inject(ServerProvider).hostname).port);
    return { port, own: `127.0.0.1:${port}` };
  };

  it("refuses a rebinding Host, on every route", async ({ expect }) => {
    const { port } = await setup();

    for (const path of ["/runs", "/apps/abcd1234/api/metadata"]) {
      const res = await send(port, path, { host: `evil.example:${port}` });
      expect(res.status).toBe(421);
    }
    // The right name on the wrong port is not this server either.
    expect((await send(port, "/runs", { host: "localhost:1" })).status).toBe(
      421,
    );
  });

  it("accepts every loopback name on its own port", async ({ expect }) => {
    const { port } = await setup();

    for (const host of [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]) {
      expect((await send(port, "/runs", { host })).status).toBe(200);
    }
  });

  it("refuses a cross-origin write, and an opaque origin", async ({
    expect,
  }) => {
    const { port, own } = await setup();

    const cross = await send(
      port,
      "/apps/abcd1234/api/db/users/records/1",
      { host: own, origin: "https://evil.example" },
      "DELETE",
    );
    expect(cross.status).toBe(403);

    const opaque = await send(port, "/runs", { host: own, origin: "null" });
    expect(opaque.status).toBe(403);
  });

  it("lets same-origin and Origin-less requests through", async ({
    expect,
  }) => {
    const { port, own } = await setup();

    expect(
      (await send(port, "/runs", { host: own, origin: `http://${own}` }))
        .status,
    ).toBe(200);
    // curl, a script: no browser being abused.
    expect((await send(port, "/runs", { host: own })).status).toBe(200);
  });

  it("never sends an Access-Control-Allow header", async ({ expect }) => {
    const { port, own } = await setup();

    const res = await send(port, "/runs", {
      host: own,
      origin: `http://${own}`,
    });

    expect(
      Object.keys(res.headers).filter((name) =>
        name.startsWith("access-control-allow"),
      ),
    ).toEqual([]);
  });
});
