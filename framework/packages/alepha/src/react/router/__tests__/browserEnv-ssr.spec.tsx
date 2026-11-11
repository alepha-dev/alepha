import { $env, $inject, Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $page } from "../index.ts";

/**
 * How a page hands the browser its `browser: true` env keys (#Q3323): a
 * server-rendered page carries the runtime values in a head data block; a
 * page rendered at build time (prerendered, or a static site's HTML)
 * carries none and loads `/config.js`, which the server answers from its
 * runtime env.
 */
describe("browser env keys in the page", () => {
  class Config {
    env = $env(
      z.object({
        API_URL: z.text({ browser: true }),
        LOG_HOST: z.text({ secret: false }),
        TOKEN: z.text(),
      }),
    );
  }

  class App {
    config = $inject(Config);
    home = $page({ path: "/", component: () => "Home" });
  }

  const create = (apiUrl: string) =>
    Alepha.create({
      env: {
        API_URL: apiUrl,
        LOG_HOST: "logs.example.com",
        TOKEN: "s3cret-token",
      },
    });

  it("puts the runtime values of the browser keys, and only those, in the head before the entry", async ({
    expect,
  }) => {
    const alepha = create("https://runtime.example.com");
    const app = alepha.inject(App);
    await alepha.start();

    const { html } = await app.home.render({ html: true });

    const block =
      /<script id="__alepha_env" type="application\/json">(.*?)<\/script>/.exec(
        html,
      );
    expect(block).not.toBeNull();
    expect(JSON.parse(block![1])).toEqual({
      API_URL: "https://runtime.example.com",
    });
    expect(html).not.toContain("logs.example.com");
    expect(html).not.toContain("s3cret-token");
    expect(html).not.toContain("/config.js");
    expect(html.indexOf("__alepha_env")).toBeLessThan(html.indexOf("<body"));
    await alepha.stop();
  });

  it("bakes no value into a page rendered at build time, which loads /config.js instead", async ({
    expect,
  }) => {
    const alepha = create("https://build-machine.example.com");
    const app = alepha.inject(App);
    // What the prerender does: configure, never start.
    await alepha.events.emit("configure", alepha);

    const { html } = await app.home.render({ html: true });

    expect(html).toContain('<script src="/config.js"></script>');
    expect(html).not.toContain("build-machine.example.com");
    expect(html).not.toContain("__alepha_env");
  });

  it("answers /config.js from the runtime env, with no long cache", async ({
    expect,
  }) => {
    const alepha = create("https://runtime.example.com");
    alepha.inject(App);
    await alepha.start();

    const response = await fetch(
      `${alepha.inject(ServerProvider).hostname}/config.js`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(await response.text()).toBe(
      'globalThis.__ALEPHA_ENV__ = {"API_URL":"https://runtime.example.com"};\n',
    );
    await alepha.stop();
  });

  it("emits nothing when the app declares no browser key", async ({
    expect,
  }) => {
    class Plain {
      home = $page({ path: "/", component: () => "Home" });
    }
    const alepha = Alepha.create();
    const app = alepha.inject(Plain);
    await alepha.start();

    const { html } = await app.home.render({ html: true });
    const response = await fetch(
      `${alepha.inject(ServerProvider).hostname}/config.js`,
    );

    expect(html).not.toContain("__alepha_env");
    expect(html).not.toContain("config.js");
    expect(response.status).toBe(404);
    await alepha.stop();
  });
});
