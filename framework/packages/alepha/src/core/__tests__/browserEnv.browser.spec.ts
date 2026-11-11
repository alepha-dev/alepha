import { afterEach, describe, it } from "vitest";

import { $env, Alepha, z } from "../index.ts";

/**
 * The browser side of `browser: true` keys (#Q3323): `Alepha.create()` reads
 * them from `config.js`'s global, else from a server-rendered page's head
 * payload, before any `$env` runs.
 */
describe("browser env in the browser", () => {
  class Config {
    env = $env(z.object({ API_URL: z.text({ browser: true }) }));
  }

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ALEPHA_ENV__;
    document.getElementById("__alepha_env")?.remove();
  });

  it("reads config.js's global", ({ expect }) => {
    (globalThis as Record<string, unknown>).__ALEPHA_ENV__ = {
      API_URL: "https://from-config.example.com",
    };

    const config = Alepha.create().inject(Config);

    expect(config.env.API_URL).toBe("https://from-config.example.com");
  });

  it("reads the head payload of a server-rendered page", ({ expect }) => {
    const element = document.createElement("script");
    element.id = "__alepha_env";
    element.type = "application/json";
    element.textContent = JSON.stringify({
      API_URL: "https://from-ssr.example.com",
    });
    document.head.append(element);

    const config = Alepha.create().inject(Config);

    expect(config.env.API_URL).toBe("https://from-ssr.example.com");
  });

  it("lets an explicit env win", ({ expect }) => {
    (globalThis as Record<string, unknown>).__ALEPHA_ENV__ = {
      API_URL: "https://from-config.example.com",
    };

    const config = Alepha.create({
      env: { API_URL: "https://explicit.example.com" },
    }).inject(Config);

    expect(config.env.API_URL).toBe("https://explicit.example.com");
  });
});
