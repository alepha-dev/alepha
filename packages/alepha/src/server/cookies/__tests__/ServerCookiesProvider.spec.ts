import { Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { describe, expect, test } from "vitest";
import { $cookie, AlephaServerCookies } from "../index.ts";

// A strong, 32-character secret for testing purposes
const TEST_COOKIE_SECRET = "DCf6DvpLAfwy8XdPRucMO4tPS6dVCHob";

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

  // An action to test the cookie functionality in a request cycle
  cookie_test = $action({
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
      // Set some cookies
      this.session.set({ userId: 123, role: "admin" });
      this.signed.set("i-am-signed");
      this.encrypted.set({ apiKey: "secret-key" });
      this.secure_all.set({ data: "super sensitive data" });

      // Read a cookie from the request
      const incomingSession = this.session.get({ cookies });

      // Delete a cookie
      if (incomingSession?.role === "guest") {
        this.signed.del();
      }

      return { incomingSession, reqCookies: cookies };
    },
  });
}

const alepha = Alepha.create({
  env: {
    COOKIE_SECRET: TEST_COOKIE_SECRET,
  },
})
  .with(AlephaServer)
  .with(AlephaServerCookies);

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
  test("should set and get a basic cookie", async () => {
    const { data, setCookieHeader } = await makeRequest();

    // The handler receives no initial cookie
    expect(data.incomingSession).toBeUndefined();

    // Check if the response sets the cookie correctly
    expect(setCookieHeader).toBeDefined();
    const decodedValue = JSON.parse(
      decodeURIComponent(setCookieHeader!.match(/session=([^;]*)/)![1]),
    );
    expect(decodedValue).toEqual({ userId: 123, role: "admin" });
  });

  test("should correctly read an incoming cookie", async () => {
    const sessionData = { userId: 456, role: "user" };
    const cookieHeader = `session=${encodeURIComponent(JSON.stringify(sessionData))}`;

    const { data } = await makeRequest(cookieHeader);

    // The handler should have received and parsed the cookie
    expect(data.incomingSession).toEqual(sessionData);
  });

  test("should set and get a signed cookie", async () => {
    const { setCookieHeader } = await makeRequest();
    const signedCookie = setCookieHeader!.match(/signed_session=([^;]*)/)![1];

    // Make a new request with the signed cookie
    const { data } = await makeRequest(`signed_session=${signedCookie}`);

    // The `get` method should successfully validate the signature and return the value
    expect(app.signed.get({ cookies: data.reqCookies })).toBe("i-am-signed");
  });

  test("should reject a tampered signed cookie", async () => {
    const { setCookieHeader } = await makeRequest();
    let tamperedCookie = setCookieHeader!.match(/signed_session=([^;]*)/)![1];
    tamperedCookie += "tampered"; // alter the cookie value

    const { data } = await makeRequest(`signed_session=${tamperedCookie}`);

    // The get should fail and return undefined
    expect(app.signed.get({ cookies: data.reqCookies })).toBeUndefined();
  });

  test("should set and get an encrypted cookie", async () => {
    const { setCookieHeader } = await makeRequest();
    const encryptedCookie = setCookieHeader!.match(
      /encrypted_secret=([^;]*)/,
    )![1];

    // The value should not be plain text
    expect(decodeURIComponent(encryptedCookie)).not.toContain("secret-key");

    const { data } = await makeRequest(`encrypted_secret=${encryptedCookie}`);

    expect(app.encrypted.get({ cookies: data.reqCookies })).toEqual({
      apiKey: "secret-key",
    });
  });

  test("should reject a tampered encrypted cookie", async () => {
    const { setCookieHeader } = await makeRequest();
    const tamperedCookie = setCookieHeader!.match(
      /encrypted_secret=([^;]*)/,
    )![1];

    const { data } = await makeRequest(
      `encrypted_secret=aa${tamperedCookie}aa`,
    );

    // The get should fail (throw internally) and return undefined
    expect(app.encrypted.get({ cookies: data.reqCookies })).toBeUndefined();
  });

  test("should handle a combination of compress, sign, and encrypt", async () => {
    const { setCookieHeader } = await makeRequest();
    const secureCookie = setCookieHeader!.match(/ultra_secure=([^;]*)/)![1];

    const { data } = await makeRequest(`ultra_secure=${secureCookie}`);

    expect(app.secure_all.get({ cookies: data.reqCookies })).toEqual({
      data: "super sensitive data",
    });
  });

  test("should delete a cookie", async () => {
    const sessionData = { userId: 789, role: "guest" };
    const cookieHeader = `session=${encodeURIComponent(JSON.stringify(sessionData))}`;

    const { setCookieHeader } = await makeRequest(cookieHeader);

    // The handler should detect role === 'guest' and delete the signed cookie
    expect(setCookieHeader).toContain("signed_session=; Path=/; Max-Age=0");
  });

  test("should serialize all cookie attributes correctly", async () => {
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
        handler: () => {
          this.advanced.set("value");
        },
      });
    }

    const attrAlepha = Alepha.create({
      env: { COOKIE_SECRET: TEST_COOKIE_SECRET },
    })
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
        handler: () => {
          this.tokens.set({ value: "from-app" });
        },
      });
      read = $action({
        schema: {
          response: z.object({ value: z.text().optional() }),
        },
        handler: ({ cookies }) => {
          return { value: this.tokens.get({ cookies })?.value };
        },
      });
    }

    const makeApp = (appName: string) =>
      Alepha.create({
        env: { COOKIE_SECRET: TEST_COOKIE_SECRET, APP_NAME: appName },
      })
        .with(AlephaServer)
        .with(AlephaServerCookies)
        .with(TokenApp);

    test("prefixes the cookie name with the lowercased APP_NAME", async () => {
      const appA = makeApp("AppA");
      await appA.start();

      const response = await appA.inject(TokenApp).set.fetch();
      const setCookieHeader = response.headers.get("set-cookie");

      // Cookie is written under the namespaced name, not the bare "tokens".
      expect(setCookieHeader).toContain("appa.tokens=");
      expect(setCookieHeader).not.toMatch(/(^|; )tokens=/);
    });

    test("two apps sharing a cookie jar do not collide", async () => {
      const appA = makeApp("AppA");
      const appB = makeApp("AppB");
      await appA.start();
      await appB.start();

      // App A writes its cookie.
      const responseA = await appA.inject(TokenApp).set.fetch();
      const cookieA = responseA.headers
        .get("set-cookie")!
        .match(/appa\.tokens=([^;]*)/)![1];

      // App A reads its own cookie back from the shared jar — works.
      const incoming = `appa.tokens=${cookieA}`;
      const readA = await appA
        .inject(TokenApp)
        .read.fetch({}, { request: { headers: { cookie: incoming } } });
      expect(readA.data.value).toBe("from-app");

      // App B sees the SAME jar (same host:localhost), but reads under
      // "appb.tokens" — so App A's cookie is invisible to it. No collision,
      // no failed-decrypt-then-delete logout.
      const readB = await appB
        .inject(TokenApp)
        .read.fetch({}, { request: { headers: { cookie: incoming } } });
      expect(readB.data.value).toBeUndefined();
    });
  });

  // test("should throw if secret is missing for secure cookies", async () => {
  // 	class AppWithMissingSecret {
  // 		badCookie = $cookie({
  // 			name: "bad",
  // 			schema: z.text(),
  // 			sign: true,
  // 		});
  // 	}
  //
  // 	const alephaWithoutSecret = Alepha.create()
  // 		.with(AlephaServer)
  // 		.with(AlephaServerCookies)
  // 		.with(AppWithMissingSecret);
  //
  // 	await expect(() => alephaWithoutSecret.start()).rejects.toThrow(
  // 		/COOKIE_SECRET environment variable is not set/,
  // 	);
  // });
});
