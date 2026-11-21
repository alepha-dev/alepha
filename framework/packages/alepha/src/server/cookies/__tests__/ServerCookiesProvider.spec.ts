import { randomBytes } from "node:crypto";

import { Alepha, z } from "alepha";
import { $action, $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $cookie, AlephaServerCookies } from "../index.ts";

// --- Test Application Setup ---

class CookieTestApp {
  // 1. Basic Cookie
  session = $cookie({
    name: "session",
    schema: z.object({ userId: z.number(), role: z.text() }),
  });

  // 2. Signed Cookie
  signed = $cookie({
    name: "signed_session",
    schema: z.text(),
    sign: true,
  });

  // 3. Encrypted Cookie
  encrypted = $cookie({
    name: "encrypted_secret",
    schema: z.object({ apiKey: z.text() }),
    encrypt: true,
  });

  // 4. Compressed, Signed, and Encrypted Cookie with TTL
  secure_all = $cookie({
    name: "ultra_secure",
    schema: z.object({ data: z.text() }),
    compress: true,
    sign: true,
    encrypt: true,
    ttl: [1, "hour"],
  });

  // 5. A value over one cookie's worth, written as chunks
  large = $cookie({
    name: "large",
    schema: z.object({ data: z.text({ size: "rich" }) }),
    encrypt: true,
  });

  // An action to test the cookie functionality in a request cycle
  cookie_test = $action({
    path: "/cookie_test",
    method: "GET",
    schema: {
      response: z.object({
        incomingSession: this.session.options.schema.optional(),
        reqCookies: z.object({
          req: z.record(z.text(), z.text()),
          res: z.record(z.text(), z.any()),
        }),
      }),
    },
    handler: ({ cookies }) => {
      // Read a cookie from the request, before anything is written: a read
      // sees what the response has set since.
      const incomingSession = this.session.get({ cookies });
      // The request's cookies alone, for a spec to read them back.
      const reqCookies = { req: { ...cookies.req }, res: {} };

      // Set some cookies
      this.session.set({ userId: 123, role: "admin" });
      this.signed.set("i-am-signed");
      this.encrypted.set({ apiKey: "secret-key" });
      this.secure_all.set({ data: "super sensitive data" });

      // Delete a cookie
      if (incomingSession?.role === "guest") {
        this.signed.del();
      }

      return { incomingSession, reqCookies };
    },
  });

  // What a read answers after a write or a delete in the same request.
  read_your_writes = $action({
    path: "/read_your_writes",
    method: "GET",
    schema: {
      response: z.object({
        before: z.text().optional(),
        afterSet: z.text().optional(),
        afterDel: z.text().optional(),
        afterSetAgain: z.text().optional(),
        afterExpiredSet: z.text().optional(),
        large: z.number().optional(),
        largeAfterDel: z.number().optional(),
      }),
    },
    handler: () => {
      const before = this.signed.get();
      this.signed.set("second");
      const afterSet = this.signed.get();
      this.signed.del();
      const afterDel = this.signed.get();
      this.signed.set("third");
      const afterSetAgain = this.signed.get();

      // A lifetime already over: a browser drops the cookie on arrival.
      this.signed.set("fourth", { ttl: [-1, "seconds"] });
      const afterExpiredSet = this.signed.get();

      // Over one cookie's worth: written and read back as chunks.
      this.large.set({ data: randomBytes(6000).toString("base64url") });
      const large = this.large.get()?.data.length;
      this.large.del();
      const largeAfterDel = this.large.get()?.data.length;

      return {
        before,
        afterSet,
        afterDel,
        afterSetAgain,
        afterExpiredSet,
        large,
        largeAfterDel,
      };
    },
  });
}

const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCookies);

const app = alepha.inject(CookieTestApp);

// Helper to simulate a request and capture the response headers
const makeRequest = async (incomingCookieHeader = "") => {
  const response = await app.cookie_test.fetch(
    {},
    {
      request: { headers: { cookie: incomingCookieHeader } },
    },
  );
  return {
    data: response.data,
    // The fetch client in tests might not handle multiple headers the same way a browser does.
    // We get the raw header to properly check it.
    setCookieHeader: response.raw?.headers.get("set-cookie"),
  };
};

describe("ServerCookiesProvider", () => {
  it("should set and get a basic cookie", async ({ expect }) => {
    const { data, setCookieHeader } = await makeRequest();

    // The handler receives no initial cookie
    expect(data.incomingSession).toBeUndefined();

    // Check if the response sets the cookie correctly
    expect(setCookieHeader).not.toBeNull();
    const decodedValue = JSON.parse(
      decodeURIComponent(setCookieHeader!.match(/session=([^;]*)/)![1]),
    );
    expect(decodedValue).toEqual({ userId: 123, role: "admin" });
  });

  it("should correctly read an incoming cookie", async ({ expect }) => {
    const sessionData = { userId: 456, role: "user" };
    const cookieHeader = `app.session=${encodeURIComponent(JSON.stringify(sessionData))}`;

    const { data } = await makeRequest(cookieHeader);

    // The handler should have received and parsed the cookie
    expect(data.incomingSession).toEqual(sessionData);
  });

  it("should set and get a signed cookie", async ({ expect }) => {
    const { setCookieHeader } = await makeRequest();
    const signedCookie = setCookieHeader!.match(/signed_session=([^;]*)/)![1];

    // Make a new request with the signed cookie
    const { data } = await makeRequest(`app.signed_session=${signedCookie}`);

    // The `get` method should successfully validate the signature and return the value
    expect(app.signed.get({ cookies: data.reqCookies })).toBe("i-am-signed");
  });

  it("should reject a tampered signed cookie", async ({ expect }) => {
    const { setCookieHeader } = await makeRequest();
    let tamperedCookie = setCookieHeader!.match(/signed_session=([^;]*)/)![1];
    tamperedCookie += "tampered"; // alter the cookie value

    const { data } = await makeRequest(`app.signed_session=${tamperedCookie}`);

    // The get should fail and return undefined
    expect(app.signed.get({ cookies: data.reqCookies })).toBeUndefined();
  });

  it("should set and get an encrypted cookie", async ({ expect }) => {
    const { setCookieHeader } = await makeRequest();
    const encryptedCookie = setCookieHeader!.match(
      /encrypted_secret=([^;]*)/,
    )![1];

    // The value should not be plain text
    expect(decodeURIComponent(encryptedCookie)).not.toContain("secret-key");

    const { data } = await makeRequest(
      `app.encrypted_secret=${encryptedCookie}`,
    );

    expect(app.encrypted.get({ cookies: data.reqCookies })).toEqual({
      apiKey: "secret-key",
    });
  });

  it("should reject a tampered encrypted cookie", async ({ expect }) => {
    const { setCookieHeader } = await makeRequest();
    const tamperedCookie = setCookieHeader!.match(
      /encrypted_secret=([^;]*)/,
    )![1];

    const { data } = await makeRequest(
      `app.encrypted_secret=aa${tamperedCookie}aa`,
    );

    // The get should fail (throw internally) and return undefined
    expect(app.encrypted.get({ cookies: data.reqCookies })).toBeUndefined();
  });

  it("should handle a combination of compress, sign, and encrypt", async ({
    expect,
  }) => {
    const { setCookieHeader } = await makeRequest();
    const secureCookie = setCookieHeader!.match(/ultra_secure=([^;]*)/)![1];

    const { data } = await makeRequest(`app.ultra_secure=${secureCookie}`);

    expect(app.secure_all.get({ cookies: data.reqCookies })).toEqual({
      data: "super sensitive data",
    });
  });

  it("should delete a cookie", async ({ expect }) => {
    const sessionData = { userId: 789, role: "guest" };
    const cookieHeader = `app.session=${encodeURIComponent(JSON.stringify(sessionData))}`;

    const { setCookieHeader } = await makeRequest(cookieHeader);

    // The handler should detect role === 'guest' and delete the signed cookie
    expect(setCookieHeader).toContain("signed_session=; Path=/; Max-Age=0");
  });

  it("reads a cookie as the request left it: set, deleted, set again", async ({
    expect,
  }) => {
    const { setCookieHeader } = await makeRequest();
    const signedCookie = setCookieHeader!.match(/signed_session=([^;]*)/)![1];

    const response = await app.read_your_writes.fetch(
      {},
      {
        request: {
          headers: { cookie: `app.signed_session=${signedCookie}` },
        },
      },
    );

    expect(response.data).toEqual({
      before: "i-am-signed",
      afterSet: "second",
      afterDel: undefined,
      afterSetAgain: "third",
      afterExpiredSet: undefined,
      large: 8000,
      largeAfterDel: undefined,
    });
  });

  it("should serialize all cookie attributes correctly", async ({ expect }) => {
    class AttrApp {
      advanced = $cookie({
        name: "advanced",
        schema: z.text(),
        path: "/admin",
        ttl: [30, "minutes"],
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        domain: "example.com",
      });
      test = $action({
        path: "/test",
        method: "GET",
        handler: () => {
          this.advanced.set("value");
        },
      });
    }

    const attrAlepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCookies)
      .with(AttrApp);

    await attrAlepha.start();

    const response = await attrAlepha.inject(AttrApp).test.fetch();
    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("Max-Age=1800");
    expect(setCookieHeader).toContain("Path=/admin");
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=strict");
    expect(setCookieHeader).toContain("Domain=example.com");
    // Secure flag is not added in tests unless protocol is https, which is handled by the provider
  });

  describe("APP_NAME namespacing", () => {
    class TokenApp {
      tokens = $cookie({
        name: "tokens",
        schema: z.object({ value: z.text() }),
      });
      set = $action({
        path: "/set",
        method: "GET",
        handler: () => {
          this.tokens.set({ value: "from-app" });
        },
      });
      read = $action({
        path: "/read",
        method: "GET",
        schema: {
          response: z.object({ value: z.text().optional() }),
        },
        handler: ({ cookies }) => {
          return { value: this.tokens.get({ cookies })?.value };
        },
      });
    }

    const makeApp = (appName: string) =>
      Alepha.create({ env: { APP_NAME: appName } })
        .with(AlephaServer)
        .with(AlephaServerCookies)
        .with(TokenApp);

    it("prefixes the cookie name with the lowercased APP_NAME", async ({
      expect,
    }) => {
      const appA = makeApp("AppA");
      await appA.start();

      const response = await appA.inject(TokenApp).set.fetch();
      const setCookieHeader = response.headers.get("set-cookie");

      // Cookie is written under the namespaced name, not the bare "tokens".
      expect(setCookieHeader).toContain("appa.tokens=");
      expect(setCookieHeader).not.toMatch(/(^|; )tokens=/);
    });

    it("prefixes with alepha.name when APP_NAME is unset: never the bare name", async ({
      expect,
    }) => {
      const app = Alepha.create()
        .with(AlephaServer)
        .with(AlephaServerCookies)
        .with(TokenApp);
      await app.start();

      const response = await app.inject(TokenApp).set.fetch();
      const setCookieHeader = response.headers.get("set-cookie");

      // No build ran, so alepha.name is "app".
      expect(setCookieHeader).toContain("app.tokens=");
      expect(setCookieHeader).not.toMatch(/(^|; )tokens=/);
    });

    it("two apps sharing a cookie jar do not collide", async ({ expect }) => {
      const appA = makeApp("AppA");
      const appB = makeApp("AppB");
      await appA.start();
      await appB.start();

      // App A writes its cookie.
      const responseA = await appA.inject(TokenApp).set.fetch();
      const cookieA = responseA.headers
        .get("set-cookie")!
        .match(/appa\.tokens=([^;]*)/)![1];

      // App A reads its own cookie back from the shared jar: works.
      const incoming = `appa.tokens=${cookieA}`;
      const readA = await appA
        .inject(TokenApp)
        .read.fetch({}, { request: { headers: { cookie: incoming } } });
      expect(readA.data.value).toBe("from-app");

      // App B sees the SAME jar (same host:localhost), but reads under
      // "appb.tokens", so App A's cookie is invisible to it. No collision,
      // no failed-decrypt-then-delete logout.
      const readB = await appB
        .inject(TokenApp)
        .read.fetch({}, { request: { headers: { cookie: incoming } } });
      expect(readB.data.value).toBeUndefined();
    });

    /**
     * The browser `$cookie` variant cannot see `APP_NAME` (it is neither
     * bundled nor hydrated), so it always reads and writes the bare name. A
     * cookie shared between the two sides (i18n's `lang`, the UI theme) must
     * therefore opt out of the namespace: left prefixed, the server writes and
     * looks for `appa.lang` while the browser writes `lang`, and neither side
     * ever sees the other's value.
     */
    describe("prefix: false, for cookies the browser also writes", () => {
      class PrefApp {
        lang = $cookie({
          name: "lang",
          schema: z.text(),
          prefix: false,
        });

        set = $action({
          path: "/set",
          method: "GET",
          handler: () => {
            this.lang.set("fr");
          },
        });

        read = $action({
          path: "/read",
          method: "GET",
          schema: { response: z.object({ value: z.text().optional() }) },
          handler: ({ cookies }) => ({ value: this.lang.get({ cookies }) }),
        });
      }

      const makePrefApp = () =>
        Alepha.create({ env: { APP_NAME: "AppA" } })
          .with(AlephaServer)
          .with(AlephaServerCookies)
          .with(PrefApp);

      it("the server writes it under the bare name", async ({ expect }) => {
        const app = makePrefApp();
        await app.start();

        const response = await app.inject(PrefApp).set.fetch();
        const setCookieHeader = response.headers.get("set-cookie");

        expect(setCookieHeader).toContain("lang=");
        expect(setCookieHeader).not.toContain("appa.lang=");
      });

      it("the server reads back what the browser wrote", async ({ expect }) => {
        const app = makePrefApp();
        await app.start();

        // Exactly what the browser variant puts in document.cookie: the bare
        // name, JSON-encoded then URI-encoded.
        const read = await app
          .inject(PrefApp)
          .read.fetch(
            {},
            { request: { headers: { cookie: "lang=%22fr%22" } } },
          );

        expect(read.data.value).toBe("fr");
      });
    });
  });

  it("keeps a Set-Cookie the handler wrote on the reply itself", async ({
    expect,
  }) => {
    class RawApp {
      session = $cookie({ name: "session", schema: z.text() });

      mixed = $route({
        path: "/mixed",
        handler: ({ reply }) => {
          reply.headers["set-cookie"] = ["raw=1; Path=/"];
          this.session.set("value");
          return "ok";
        },
      });
    }

    const rawAlepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with(AlephaServer)
      .with(AlephaServerCookies)
      .with(RawApp);
    await rawAlepha.start();

    const response = await fetch(
      `${rawAlepha.inject(ServerProvider).hostname}/mixed`,
    );

    expect(response.headers.getSetCookie()).toEqual([
      "raw=1; Path=/",
      "app.session=%22value%22; Path=/; SameSite=lax",
    ]);
  });

  it("should delete a scoped cookie with its own path and domain", async ({
    expect,
  }) => {
    // The deletion must carry the same Path and Domain the cookie was written
    // with, or the browser keeps it.
    class ScopedApp {
      admin = $cookie({
        name: "admin_session",
        schema: z.text(),
        path: "/admin",
        domain: ".example.com",
      });

      logout = $action({
        path: "/logout",
        method: "GET",
        schema: { response: z.text() },
        handler: () => {
          this.admin.del();
          return "bye";
        },
      });
    }

    const scopedAlepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCookies);
    const scopedApp = scopedAlepha.inject(ScopedApp);
    await scopedAlepha.start();

    const response = await scopedApp.logout.fetch();
    const header = response.raw?.headers.get("set-cookie") ?? "";

    expect(header).toContain("Path=/admin");
    expect(header).toContain("Domain=.example.com");
    expect(header).toContain("Max-Age=0");
  });
});
