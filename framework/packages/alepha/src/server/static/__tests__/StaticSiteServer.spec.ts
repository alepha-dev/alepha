import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

import { StaticSiteServer } from "../index.ts";

/**
 * The server `alepha image` runs for a static build (#Q3324): the site rules,
 * and `/config.js` answered from the process's environment for the keys the
 * manifest lists, and nothing else.
 */
describe("StaticSiteServer", () => {
  let dist: string;

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), "alepha-static-site-server-"));
    await mkdir(join(dist, "public"), { recursive: true });
    await writeFile(join(dist, "public", "index.html"), "home");
    await writeFile(join(dist, "public", "200.html"), "shell");
    await writeFile(
      join(dist, "public", "config.js"),
      'globalThis.__ALEPHA_ENV__ = {"API_URL":"https://build-machine.example.com"};\n',
    );
    await writeFile(
      join(dist, "manifest.json"),
      JSON.stringify({ browser: ["API_URL"] }),
    );
  });

  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  const start = async () => {
    const alepha = Alepha.create({
      env: {
        STATIC_ROOT: join(dist, "public"),
        STATIC_MANIFEST: join(dist, "manifest.json"),
        API_URL: "https://runtime.example.com",
        TOKEN: "s3cret",
      },
    }).with(StaticSiteServer);
    await alepha.start();
    return {
      base: alepha.inject(ServerProvider).hostname,
      stop: () => alepha.stop(),
    };
  };

  it("answers /config.js from the environment, for the manifest's keys only", async ({
    expect,
  }) => {
    const { base, stop } = await start();

    const response = await fetch(`${base}/config.js`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe(
      'globalThis.__ALEPHA_ENV__ = {"API_URL":"https://runtime.example.com"};\n',
    );
    expect(body).not.toContain("s3cret");
    expect(body).not.toContain("build-machine");
    await stop();
  });

  it("serves the site with its fallbacks", async ({ expect }) => {
    const { base, stop } = await start();

    expect(await (await fetch(`${base}/`)).text()).toBe("home");
    const route = await fetch(`${base}/client/route`);
    expect(route.status).toBe(200);
    expect(await route.text()).toBe("shell");
    await stop();
  });
});
