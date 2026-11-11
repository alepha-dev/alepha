import { describe, it } from "vitest";

import { $env, $inject, Alepha, z } from "../index.ts";

/**
 * `browser: true` on an `$env` key (#Q3323): the one annotation that lets the
 * browser read it. It implies `secret: false`, contradicts an explicit
 * `secret: true`, and is closed by default: a key without it never leaves
 * the server, declassified or not.
 */
describe("browser env keys", () => {
  class Config {
    env = $env(
      z.object({
        API_URL: z.text({ browser: true }),
        FEATURE: z.boolean().meta({ browser: true }).default(false),
        LOG_HOST: z.text({ secret: false }),
        TOKEN: z.text(),
      }),
    );
  }

  const create = () =>
    Alepha.create({
      env: {
        API_URL: "https://api.example.com",
        LOG_HOST: "logs.example.com",
        TOKEN: "s3cret",
      },
    });

  it("hands out only the browser keys, with their parsed values", ({
    expect,
  }) => {
    const alepha = create();
    alepha.inject(Config);

    expect(alepha.browserEnvKeys()).toEqual(["API_URL", "FEATURE"]);
    expect(alepha.browserEnv()).toEqual({
      API_URL: "https://api.example.com",
      FEATURE: "false",
    });
  });

  it("marks them browser and not secret in dump(), and leaves secret: false keys alone", ({
    expect,
  }) => {
    const alepha = create();
    alepha.inject(Config);

    const { env } = alepha.dump();

    expect(env.API_URL).toMatchObject({ browser: true, secret: false });
    expect(env.FEATURE).toMatchObject({ browser: true, secret: false });
    expect(env.LOG_HOST.browser).toBeUndefined();
    expect(env.LOG_HOST.secret).toBe(false);
    expect(env.TOKEN.browser).toBeUndefined();
    expect(env.TOKEN.secret).toBe(true);
  });

  it("refuses a key declared browser: true and secret: true when its schema is read", ({
    expect,
  }) => {
    class Contradiction {
      env = $env(
        z.object({ KEY: z.text({ browser: true, secret: true, default: "" }) }),
      );
    }

    expect(() => create().inject(Contradiction)).toThrow(
      "Env key KEY is declared browser: true and secret: true",
    );
  });

  it("keeps the keys after loadEnv clears the parse cache", ({ expect }) => {
    class Reader {
      config = $inject(Config);
    }
    const alepha = create();
    alepha.inject(Reader);

    alepha.loadEnv({ OTHER: "x" });

    expect(alepha.browserEnv().API_URL).toBe("https://api.example.com");
  });
});
