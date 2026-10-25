import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DesktopSupervisor } from "../../core/DesktopSupervisor.ts";

const bootstrap = new URL("./fixtures/bootstrap.ts", import.meta.url).href;
const capability = "ef".repeat(32);

/**
 * A raw HTTP/1.1 request, so the Host header is exactly what the spec says.
 */
const raw = (
  port: number,
  path: string,
  headers: Record<string, string>,
  method = "GET",
) =>
  new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers, setHost: false },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("desktop admission over real HTTP", () => {
  const dir = mkdtempSync(join(tmpdir(), "alepha-desktop-"));
  const supervisor = new DesktopSupervisor(new Worker(bootstrap));
  let origin = "";
  let port = 0;

  beforeAll(async () => {
    const started = await supervisor.start({
      name: "Fixture",
      identifier: "dev.alepha.fixture",
      capability,
      defaults: { APP_SECRET_FILE: join(dir, "secret") },
      paths: { data: dir, logs: dir, resources: dir },
      env: {
        NODE_ENV: "production",
        LOG_LEVEL: "silent",
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: "0",
        FIXTURE_MODE: "normal",
      },
    });
    if (!started.ok) throw new Error(started.message);
    origin = started.origin;
    port = Number(new URL(origin).port);
  });

  afterAll(async () => {
    await supervisor.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses every path before bootstrap: routes, static files, unknown paths, OPTIONS and upgrades", async () => {
    for (const path of ["/hello", "/entry.js", "/no/such/page", "/"]) {
      expect((await fetch(`${origin}${path}`)).status).toBe(403);
    }
    expect((await fetch(`${origin}/hello`, { method: "OPTIONS" })).status).toBe(
      403,
    );
    expect(
      (
        await fetch(`${origin}/ws`, {
          headers: { upgrade: "websocket", connection: "Upgrade" },
        })
      ).status,
    ).toBe(403);
  });

  it("lets exactly one of two racing bootstraps through, then refuses replays", async () => {
    const url = `${origin}/__alepha_desktop/bootstrap?capability=${capability}`;
    const results = await Promise.all([
      fetch(url, { redirect: "manual" }),
      fetch(url, { redirect: "manual" }),
    ]);
    expect(
      results.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([303, 403]);
    const winner = results.find((response) => response.status === 303)!;
    const cookie = winner.headers.get("set-cookie")!.split(";")[0];

    expect((await fetch(url, { redirect: "manual" })).status).toBe(403);
    expect(
      await (await fetch(`${origin}/hello`, { headers: { cookie } })).text(),
    ).toBe("hello from the worker");
    expect(
      (await fetch(`${origin}/no/such/page`, { headers: { cookie } })).status,
    ).toBe(404);

    // The same cookie, from a page on another loopback port.
    expect(
      (
        await fetch(`${origin}/hello`, {
          headers: {
            cookie,
            origin: "http://127.0.0.1:1234",
            "sec-fetch-site": "same-site",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${origin}/hello`, { headers: { cookie, origin: "null" } }))
        .status,
    ).toBe(403);

    // A raw Host header other than the bound address, and forwarded headers.
    expect(
      await raw(port, "/hello", { host: `127.0.0.1:${port}`, cookie }),
    ).toBe(200);
    expect(
      await raw(port, "/hello", { host: `localhost:${port}`, cookie }),
    ).toBe(403);
    expect(
      await raw(port, "/hello", {
        host: "evil.test",
        "x-forwarded-host": `127.0.0.1:${port}`,
        cookie,
      }),
    ).toBe(403);
  });
});
