import { randomBytes } from "node:crypto";

import { Alepha, AlephaError, z } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $cookie, AlephaServerCookies } from "../index.ts";
import type { Cookies } from "../primitives/$cookie.ts";
import { ServerCookiesProvider } from "../providers/ServerCookiesProvider.ts";
import { BrowserJar } from "./BrowserJar.ts";

const CHUNK_LENGTH = 3800;

class ChunkApp {
  plain = $cookie({
    name: "plain",
    schema: z.object({ data: z.text({ size: "rich" }) }),
  });

  sealed = $cookie({
    name: "sealed",
    schema: z.object({ data: z.text({ size: "rich" }) }),
    encrypt: true,
  });

  signed = $cookie({
    name: "signed",
    schema: z.object({ data: z.text({ size: "rich" }) }),
    sign: true,
  });

  scoped = $cookie({
    name: "scoped",
    schema: z.object({ data: z.text({ size: "rich" }) }),
    encrypt: true,
    path: "/api",
    domain: "example.com",
    httpOnly: true,
    sameSite: "strict",
    ttl: [1, "hour"],
  });

  shared = $cookie({
    name: "shared",
    schema: z.object({ data: z.text({ size: "rich" }) }),
    prefix: false,
  });

  cookie(name: string) {
    return this[name as "sealed"];
  }

  write = $action({
    path: "/write",
    method: "POST",
    schema: {
      body: z.object({ name: z.text(), data: z.text({ size: "rich" }) }),
    },
    handler: ({ body }) => {
      this.cookie(body.name).set({ data: body.data });
    },
  });

  writeTwice = $action({
    path: "/write-twice",
    method: "POST",
    schema: {
      body: z.object({
        name: z.text(),
        first: z.text({ size: "rich" }),
        second: z.text({ size: "rich" }),
      }),
    },
    handler: ({ body }) => {
      this.cookie(body.name).set({ data: body.first });
      this.cookie(body.name).set({ data: body.second });
    },
  });

  writeThenDelete = $action({
    path: "/write-then-delete",
    method: "POST",
    schema: {
      body: z.object({ name: z.text(), data: z.text({ size: "rich" }) }),
    },
    handler: ({ body }) => {
      this.cookie(body.name).set({ data: body.data });
      this.cookie(body.name).del();
    },
  });

  read = $action({
    path: "/read",
    method: "GET",
    schema: {
      query: z.object({ name: z.text() }),
      response: z.object({ data: z.text({ size: "rich" }).optional() }),
    },
    handler: ({ cookies, query }) => ({
      data: this.cookie(query.name).get({ cookies })?.data,
    }),
  });

  remove = $action({
    path: "/remove",
    method: "POST",
    schema: { body: z.object({ name: z.text() }) },
    handler: ({ body }) => {
      this.cookie(body.name).del();
    },
  });
}

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaServer)
    .with(AlephaServerCookies)
    .with(ChunkApp);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const jar = new BrowserJar();

  const post = async (path: string, body: object) => {
    const response = await fetch(`${hostname}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie();
    jar.apply(setCookie);
    return { response, setCookie };
  };

  const write = (name: string, data: string) => post("write", { name, data });

  // A request from another tab: it carries the jar as it stands now, and its
  // Set-Cookie lands whenever its response does.
  const send = async (name: string, data: string) => {
    const response = await fetch(`${hostname}/api/write`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header },
      body: JSON.stringify({ name, data }),
    });
    return response.headers.getSetCookie();
  };

  const read = async (name: string) => {
    const response = await fetch(`${hostname}/api/read?name=${name}`, {
      headers: { cookie: jar.header },
    });
    jar.apply(response.headers.getSetCookie());
    return ((await response.json()) as { data?: string }).data;
  };

  return { alepha, jar, post, read, send, write };
};

/**
 * Text that encodes to about `length` characters: random hex survives both
 * encodeURIComponent and encryption's +33% predictably.
 */
const text = (length: number) =>
  randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);

describe("server cookie chunking", () => {
  describe("setCookie", () => {
    it("writes one plain cookie under the budget", async ({ expect }) => {
      const { jar, write } = await boot();

      const { setCookie } = await write("plain", text(1000));

      expect(setCookie).toHaveLength(1);
      expect(jar.names).toEqual(["app.plain"]);
    });

    it("splits one byte over the budget, not at it", async ({ expect }) => {
      const { alepha } = await boot();
      const provider = alepha.inject(ServerCookiesProvider);
      const options = { schema: z.text({ size: "rich" }) };
      const at: Cookies = { req: {}, res: {} };
      const over: Cookies = { req: {}, res: {} };

      // A JSON string costs its two quotes, each encoded as %22.
      provider.setCookie("edge", options, text(CHUNK_LENGTH - 6), at);
      provider.setCookie("edge", options, text(CHUNK_LENGTH - 5), over);

      expect(Object.keys(at.res)).toEqual(["app.edge"]);
      expect(Object.keys(over.res)).toEqual(["app.edge.0", "app.edge.1"]);
    });

    it("writes numbered chunks over the budget, each one a size the browser keeps", async ({
      expect,
    }) => {
      const { jar, write } = await boot();

      await write("sealed", text(10_000));

      expect(jar.names).toEqual([
        "app.sealed.0",
        "app.sealed.1",
        "app.sealed.2",
        "app.sealed.3",
      ]);
      for (const [name, value] of jar.cookies) {
        expect(name.length + value.length).toBeLessThanOrEqual(4096);
      }
    });

    it("gives every chunk the cookie's own attributes", async ({ expect }) => {
      const { write } = await boot();

      const { setCookie } = await write("scoped", text(5000));

      expect(setCookie.length).toBeGreaterThan(1);
      for (const header of setCookie) {
        expect(header).toContain("Path=/api");
        expect(header).toContain("Domain=example.com");
        expect(header).toContain("HttpOnly");
        expect(header).toContain("SameSite=strict");
        expect(header).toContain("Max-Age=3600");
      }
    });

    it("refuses a cookie the browser reads, rather than chunking it", async ({
      expect,
    }) => {
      const { alepha, jar, read, write } = await boot();
      const provider = alepha.inject(ServerCookiesProvider);

      const oversized = () =>
        provider.setCookie(
          "shared",
          { schema: z.text({ size: "rich" }), prefix: false },
          text(CHUNK_LENGTH),
          { req: {}, res: {} },
        );

      expect(oversized).toThrow(AlephaError);
      expect(oversized).toThrow(/"shared".*browser reads it/);

      const data = text(1000);
      await write("shared", data);
      expect(jar.names).toEqual(["shared"]);
      expect(await read("shared")).toBe(data);
    });

    it("leaves a same-named chunk of a browser-read cookie alone", async ({
      expect,
    }) => {
      const { alepha } = await boot();
      const provider = alepha.inject(ServerCookiesProvider);
      const cookies: Cookies = { req: { "shared.0": "other" }, res: {} };

      provider.setCookie(
        "shared",
        { schema: z.text(), prefix: false },
        "small",
        cookies,
      );
      provider.deleteCookie("shared", cookies, false);

      expect(Object.keys(cookies.res)).toEqual(["shared"]);
    });
  });

  describe("getCookie", () => {
    it("round-trips 10 KB, encrypted", async ({ expect }) => {
      const { jar, read, write } = await boot();
      const data = text(10_000);

      await write("sealed", data);

      expect(jar.names.length).toBeGreaterThan(1);
      expect(await read("sealed")).toBe(data);
    });

    it("round-trips 10 KB with no signature and no encryption", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();
      const data = text(10_000);

      await write("plain", data);

      expect(jar.names.length).toBeGreaterThan(1);
      expect(await read("plain")).toBe(data);
    });

    it("joins a value whose percent-escapes a chunk boundary cuts in half", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();
      // JSON then encodeURIComponent writes every quote as `\"`, so `%5C%22`.
      const data = '"'.repeat(1500);

      await write("plain", data);

      expect(jar.cookies.get("app.plain.0")).toMatch(/%[0-9A-F]?$/);
      expect(await read("plain")).toBe(data);
    });

    it("prefers the plain cookie when both are present", async ({ expect }) => {
      const { jar, read, write } = await boot();
      const data = text(100);

      await write("plain", data);
      jar.cookies.set("app.plain.0", "stale");

      expect(await read("plain")).toBe(data);
    });

    it.for(["sealed", "signed", "plain"])(
      "rejects and clears a %s cookie that lost its last chunk",
      async (name, { expect }) => {
        const { jar, read, write } = await boot();

        await write(name, text(5000));
        jar.cookies.delete(jar.names.at(-1)!);

        expect(await read(name)).toBeUndefined();
        expect(jar.names).toEqual([]);
      },
    );

    it("rejects and clears a cookie that lost a middle chunk, the later ones included", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();

      await write("sealed", text(10_000));
      jar.cookies.delete("app.sealed.1");

      expect(await read("sealed")).toBeUndefined();
      expect(jar.names).toEqual([]);
    });

    it("rejects and clears a cookie that lost its first chunk", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();

      await write("sealed", text(10_000));
      jar.cookies.delete("app.sealed.0");

      expect(await read("sealed")).toBeUndefined();
      expect(jar.names).toEqual([]);
    });

    it("rejects and clears a tampered chunk", async ({ expect }) => {
      const { jar, read, write } = await boot();

      await write("sealed", text(5000));
      const chunk = jar.cookies.get("app.sealed.1")!;
      jar.cookies.set(
        "app.sealed.1",
        `${chunk[0] === "A" ? "B" : "A"}${chunk.slice(1)}`,
      );

      expect(await read("sealed")).toBeUndefined();
      expect(jar.names).toEqual([]);
    });

    it("rejects and clears a signed cookie with a tampered chunk", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();

      await write("signed", text(5000));
      const chunk = jar.cookies.get("app.signed.1")!;
      // A hex digit of the value, so the value still decodes and only the
      // signature can refuse it.
      jar.cookies.set(
        "app.signed.1",
        `${chunk[0] === "a" ? "b" : "a"}${chunk.slice(1)}`,
      );

      expect(await read("signed")).toBeUndefined();
      expect(jar.names).toEqual([]);
    });

    it("rejects and clears swapped chunks", async ({ expect }) => {
      const { jar, read, write } = await boot();

      await write("sealed", text(5000));
      const first = jar.cookies.get("app.sealed.0")!;
      jar.cookies.set("app.sealed.0", jar.cookies.get("app.sealed.1")!);
      jar.cookies.set("app.sealed.1", first);

      expect(await read("sealed")).toBeUndefined();
      expect(jar.names).toEqual([]);
    });

    it("clears a broken chunked cookie in its own path and domain", async ({
      expect,
    }) => {
      const { alepha } = await boot();
      const provider = alepha.inject(ServerCookiesProvider);
      const cookies: Cookies = {
        req: { "app.broken.0": "not", "app.broken.1": "json" },
        res: {},
      };

      const value = provider.getCookie(
        "broken",
        { schema: z.text(), path: "/admin", domain: "example.com" },
        cookies,
      );

      expect(value).toBeUndefined();
      expect(Object.keys(cookies.res).sort()).toEqual([
        "app.broken",
        "app.broken.0",
        "app.broken.1",
      ]);
      for (const cookie of Object.values(cookies.res)) {
        expect(cookie).toMatchObject({
          path: "/admin",
          domain: "example.com",
          maxAge: 0,
        });
      }
    });
  });

  describe("stale chunks", () => {
    it("expires what a shrinking cookie no longer uses, from 3 chunks to 2", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();
      await write("plain", text(10_000));
      expect(jar.names).toHaveLength(3);
      const data = text(5000);

      await write("plain", data);

      expect(jar.names).toEqual(["app.plain.0", "app.plain.1"]);
      expect(await read("plain")).toBe(data);
    });

    it("expires every chunk when a chunked cookie becomes plain", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();
      await write("plain", text(10_000));
      const data = text(100);

      await write("plain", data);

      expect(jar.names).toEqual(["app.plain"]);
      expect(await read("plain")).toBe(data);
    });

    it("expires the plain cookie when it becomes chunked", async ({
      expect,
    }) => {
      const { jar, read, write } = await boot();
      await write("plain", text(100));
      const data = text(5000);

      await write("plain", data);

      expect(jar.names).toEqual(["app.plain.0", "app.plain.1"]);
      expect(await read("plain")).toBe(data);
    });

    it("expires a stale chunk with the cookie's own path and domain", async ({
      expect,
    }) => {
      const { jar, write } = await boot();
      await write("scoped", text(10_000));
      const stale = jar.names.at(-1)!;

      const { setCookie } = await write("scoped", text(100));

      const expiry = setCookie.find((it) => it.startsWith(`${stale}=`))!;
      expect(expiry).toContain("Max-Age=0");
      expect(expiry).toContain("Path=/api");
      expect(expiry).toContain("Domain=example.com");
    });

    it("keeps one value when a response writes the same cookie twice", async ({
      expect,
    }) => {
      const { jar, post, read } = await boot();
      const data = text(100);

      await post("write-twice", {
        name: "plain",
        first: text(10_000),
        second: data,
      });

      expect(jar.names).toEqual(["app.plain"]);
      expect(await read("plain")).toBe(data);
    });

    it("leaves a neighbouring cookie whose name only starts the same", async ({
      expect,
    }) => {
      const { jar, write } = await boot();
      for (const name of ["app.plain.extra", "app.plain.0x", "app.plain.01"]) {
        jar.cookies.set(name, "neighbour");
      }
      jar.cookies.set("app.plainer.0", "neighbour");

      await write("plain", text(10_000));
      await write("plain", text(100));

      expect(jar.names).toEqual([
        "app.plain",
        "app.plain.01",
        "app.plain.0x",
        "app.plain.extra",
        "app.plainer.0",
      ]);
    });
  });

  /**
   * Two requests carry the same chunks, so neither response can expire what the
   * other one writes. Whichever lands last has to win, as it would for one
   * cookie, whatever the other left behind.
   */
  describe("concurrent writes", () => {
    const LONGER = 9000; // four chunks once encrypted
    const SHORTER = 5000; // two chunks once encrypted

    it("reads a shorter write that lands last, past the longer one's tail", async ({
      expect,
    }) => {
      const { jar, read, send, write } = await boot();
      await write("sealed", text(SHORTER));
      const data = text(SHORTER);

      const [longer, shorter] = await Promise.all([
        send("sealed", text(LONGER)),
        send("sealed", data),
      ]);
      jar.apply(longer);
      jar.apply(shorter);

      expect(jar.names).toHaveLength(4);
      expect(await read("sealed")).toBe(data);
    });

    it("reads a longer write that lands last", async ({ expect }) => {
      const { jar, read, send, write } = await boot();
      await write("sealed", text(SHORTER));
      const data = text(LONGER);

      const [longer, shorter] = await Promise.all([
        send("sealed", data),
        send("sealed", text(SHORTER)),
      ]);
      jar.apply(shorter);
      jar.apply(longer);

      expect(jar.names).toHaveLength(4);
      expect(await read("sealed")).toBe(data);
    });

    it("leaves the tail for the next write to expire, not for a read", async ({
      expect,
    }) => {
      const { jar, read, send, write } = await boot();
      await write("sealed", text(SHORTER));
      const [longer, shorter] = await Promise.all([
        send("sealed", text(LONGER)),
        send("sealed", text(SHORTER)),
      ]);
      jar.apply(longer);
      jar.apply(shorter);

      await read("sealed");
      expect(jar.names).toHaveLength(4);

      const data = text(SHORTER);
      await write("sealed", data);

      expect(jar.names).toEqual(["app.sealed.0", "app.sealed.1"]);
      expect(await read("sealed")).toBe(data);
    });
  });

  describe("the chunk count", () => {
    const countOf = (jar: BrowserJar) =>
      jar.cookies.get("app.sealed.0")!.split("~")[0];

    const withFirstChunk = (jar: BrowserJar, rewrite: (v: string) => string) =>
      jar.cookies.set(
        "app.sealed.0",
        rewrite(jar.cookies.get("app.sealed.0")!),
      );

    it("opens the first chunk and only the first", async ({ expect }) => {
      const { jar, write } = await boot();

      await write("sealed", text(5000));

      expect(countOf(jar)).toBe("2");
      expect(jar.cookies.get("app.sealed.1")).not.toContain("~");
    });

    it.for([
      ["is missing", (value: string) => value.slice(value.indexOf("~") + 1)],
      ["is past the chunks", (value: string) => value.replace(/^\d+/, "3")],
      ["is below the chunks", (value: string) => value.replace(/^\d+/, "1")],
      ["is not a number", (value: string) => value.replace(/^\d+/, "x")],
    ] as const)(
      "rejects and clears a cookie whose count %s",
      async ([, rewrite], { expect }) => {
        const { jar, read, write } = await boot();

        await write("sealed", text(5000));
        withFirstChunk(jar, rewrite);

        expect(await read("sealed")).toBeUndefined();
        expect(jar.names).toEqual([]);
      },
    );
  });

  describe("deleteCookie", () => {
    it("expires the plain cookie and every chunk", async ({ expect }) => {
      const { jar, post, read, write } = await boot();
      await write("sealed", text(10_000));

      await post("remove", { name: "sealed" });

      expect(jar.names).toEqual([]);
      expect(await read("sealed")).toBeUndefined();
    });

    it("expires every chunk the request carried, past a gap too", async ({
      expect,
    }) => {
      const { jar, post, write } = await boot();
      await write("sealed", text(10_000));
      jar.cookies.delete("app.sealed.1");

      await post("remove", { name: "sealed" });

      expect(jar.names).toEqual([]);
    });

    it("keeps the path and domain on each expiry", async ({ expect }) => {
      const { jar, post, write } = await boot();
      await write("scoped", text(10_000));
      const names = jar.names;

      const { setCookie } = await post("remove", { name: "scoped" });

      expect(setCookie).toHaveLength(names.length + 1);
      for (const header of setCookie) {
        expect(header).toContain("Max-Age=0");
        expect(header).toContain("Path=/api");
        expect(header).toContain("Domain=example.com");
      }
    });

    it("takes back chunks written earlier in the same response", async ({
      expect,
    }) => {
      const { jar, post } = await boot();

      await post("write-then-delete", { name: "plain", data: text(10_000) });

      expect(jar.names).toEqual([]);
    });
  });
});
