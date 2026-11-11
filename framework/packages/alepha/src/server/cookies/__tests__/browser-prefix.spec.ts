import { Alepha, z } from "alepha";
import { $route, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $cookie } from "../primitives/$cookie.ts";

/**
 * `browserPrefix` puts a prefix the browser enforces in front of the cookie
 * name, on exactly the responses that carry `Secure`.
 */

class App {
  session = $cookie({
    name: "session",
    httpOnly: true,
    secure: true,
    browserPrefix: "__Host-Http-",
    schema: z.object({ value: z.text({ size: "rich" }) }),
  });

  write = $route({
    path: "/write",
    schema: { query: z.object({ size: z.integer().default(10) }) },
    handler: ({ query }) => {
      this.session.set({ value: "x".repeat(query.size) });
      return "ok";
    },
  });

  read = $route({
    path: "/read",
    handler: () => this.session.get()?.value ?? "",
  });

  drop = $route({
    path: "/drop",
    handler: () => {
      this.session.del();
      return "ok";
    },
  });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(App);
  await alepha.start();
  const hostname = alepha.inject(ServerProvider).hostname;

  const call = async (
    path: string,
    options: { https?: boolean; cookie?: string } = {},
  ) => {
    const response = await fetch(`${hostname}${path}`, {
      headers: {
        ...(options.https ? { "x-forwarded-proto": "https" } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
    });
    return {
      body: await response.text(),
      setCookie: response.headers.getSetCookie(),
    };
  };

  return { call };
};

const pairs = (setCookie: string[]) =>
  setCookie.map((it) => it.split(";")[0]!).join("; ");

describe("$cookie({ browserPrefix })", () => {
  it("names the cookie with the prefix over https, with Secure", async () => {
    const { call } = await boot();

    const { setCookie } = await call("/write", { https: true });

    expect(setCookie).toHaveLength(1);
    expect(setCookie[0]).toMatch(/^__Host-Http-app\.session=/);
    expect(setCookie[0]).toContain("Secure");
    expect(setCookie[0]).toContain("HttpOnly");
    expect(setCookie[0]).toContain("Path=/");
    expect(setCookie[0]).not.toContain("Domain=");
  });

  it("keeps the bare name over plain http, where Secure is not sent", async () => {
    const { call } = await boot();

    const { setCookie } = await call("/write");

    expect(setCookie[0]).toMatch(/^app\.session=/);
    expect(setCookie[0]).not.toContain("Secure");
  });

  it("reads the name that matches the request's scheme", async () => {
    const { call } = await boot();

    const https = await call("/write", { https: true });
    const http = await call("/write");

    expect(
      (await call("/read", { https: true, cookie: pairs(https.setCookie) }))
        .body,
    ).toBe("x".repeat(10));
    expect((await call("/read", { cookie: pairs(http.setCookie) })).body).toBe(
      "x".repeat(10),
    );
    // The bare name is not read over https, nor the prefixed one over http.
    expect(
      (await call("/read", { https: true, cookie: pairs(http.setCookie) }))
        .body,
    ).toBe("");
    expect((await call("/read", { cookie: pairs(https.setCookie) })).body).toBe(
      "",
    );
  });

  it("puts the prefix on every chunk, deletions included", async () => {
    const { call } = await boot();

    const { setCookie } = await call("/write?size=6000", { https: true });
    const names = setCookie.map((it) => it.split("=")[0]);
    expect(names).toEqual([
      "__Host-Http-app.session.0",
      "__Host-Http-app.session.1",
    ]);
    expect(setCookie.every((it) => it.includes("Secure"))).toBe(true);

    const read = await call("/read", { https: true, cookie: pairs(setCookie) });
    expect(read.body).toBe("x".repeat(6000));

    const dropped = await call("/drop", {
      https: true,
      cookie: pairs(setCookie),
    });
    expect(dropped.setCookie.map((it) => it.split("=")[0]).sort()).toEqual([
      "__Host-Http-app.session",
      "__Host-Http-app.session.0",
      "__Host-Http-app.session.1",
    ]);
    expect(dropped.setCookie.every((it) => it.includes("Max-Age=0"))).toBe(
      true,
    );
  });

  it("expires a bare-named leftover, chunks included, on an https request", async () => {
    const { call } = await boot();

    const leftover = await call("/write?size=6000");
    const response = await call("/read", {
      https: true,
      cookie: pairs(leftover.setCookie),
    });

    expect(response.body).toBe("");
    const expired = response.setCookie
      .filter((it) => it.includes("Max-Age=0"))
      .map((it) => it.split("=")[0])
      .sort();
    expect(expired).toEqual(["app.session.0", "app.session.1"]);
  });

  it("refuses the combinations a browser would reject", () => {
    const declare = (options: Record<string, unknown>) => {
      class Bad {
        cookie = $cookie({
          name: "bad",
          schema: z.text(),
          ...options,
        } as any);
      }
      return () => Alepha.create().with(Bad);
    };

    expect(declare({ browserPrefix: "__Secure-", secure: false })).toThrow(
      /requires Secure/,
    );
    expect(
      declare({ browserPrefix: "__Host-", domain: "example.com" }),
    ).toThrow(/forbids a domain/);
    expect(declare({ browserPrefix: "__Host-", path: "/app" })).toThrow(
      /requires path/,
    );
    expect(declare({ browserPrefix: "__Http-" })).toThrow(/requires httpOnly/);
    expect(
      declare({ browserPrefix: "__Host-Http-", httpOnly: true }),
    ).not.toThrow();
  });
});

describe("cookie names from APP_NAME", () => {
  it("replaces what is not a cookie-name character", async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", APP_NAME: "My App" },
    });
    alepha.with(App);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const response = await fetch(`${hostname}/write`);

    expect(response.headers.getSetCookie()[0]).toMatch(/^my-app\.session=/);
  });
});
