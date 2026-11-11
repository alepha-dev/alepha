import { createHash } from "node:crypto";

import { Alepha, AlephaError } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  type HelmetOptions,
  helmetOptions,
  ServerHelmetProvider,
} from "../providers/ServerHelmetProvider.ts";

class TestApp {
  ping = $action({ path: "/ping", method: "GET", handler: () => "pong" });
}

const appWith = (options?: Partial<HelmetOptions>) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
  })
    .with(AlephaServer)
    .with(TestApp);
  if (options) {
    alepha.store.mut(helmetOptions, (old) => ({ ...old, ...options }));
  }
  return { alepha, helmet: alepha.inject(ServerHelmetProvider) };
};

/**
 * The policy as a map of directive to its sources, in order.
 */
const parse = (policy: string | undefined) => {
  const out: Record<string, string[]> = {};
  for (const part of (policy ?? "").split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) {
      if (out[name]) {
        throw new AlephaError(`${name} appears twice in the policy`);
      }
      out[name] = sources;
    }
  }
  return out;
};

describe("ServerHelmetProvider CSP sources", () => {
  it("appends a registered source to the default policy", ({ expect }) => {
    const { helmet } = appWith({ contentSecurityPolicy: {} });

    helmet.addCspSource("script-src", "https://cdn.example.com");

    const csp = parse(helmet.getHeaders()["content-security-policy"]);
    expect(csp["script-src"]).toEqual(["'self'", "https://cdn.example.com"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  it("appends to an app's own directives, camelCase keys included, with no duplicate directive", ({
    expect,
  }) => {
    const { helmet } = appWith({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://a.example.com"],
        },
      },
    });

    helmet.addCspSource("scriptSrc", "https://b.example.com");
    helmet.addCspSource("script-src", "https://b.example.com");

    const csp = parse(helmet.getHeaders()["content-security-policy"]);
    expect(csp["script-src"]).toEqual([
      "'self'",
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("creates a missing directive from default-src before appending", ({
    expect,
  }) => {
    const { helmet } = appWith({ contentSecurityPolicy: {} });

    helmet.addCspSource("frame-src", "https://frames.example.com");

    const csp = parse(helmet.getHeaders()["content-security-policy"]);
    expect(csp["frame-src"]).toEqual(["'self'", "https://frames.example.com"]);
  });

  it("appends nothing when the CSP is off, or when directives is empty", ({
    expect,
  }) => {
    const off = appWith();
    off.helmet.addCspSource("script-src", "https://cdn.example.com");
    expect(off.helmet.isCspEnabled()).toBe(false);
    expect(off.helmet.getHeaders()["content-security-policy"]).toBeUndefined();

    const empty = appWith({ contentSecurityPolicy: { directives: {} } });
    empty.helmet.addCspSource("script-src", "https://cdn.example.com");
    expect(empty.helmet.isCspEnabled()).toBe(false);
    expect(
      empty.helmet.getHeaders()["content-security-policy"],
    ).toBeUndefined();
  });

  it("rebuilds the cached header when a source is added", ({ expect }) => {
    const { helmet } = appWith({ contentSecurityPolicy: {} });
    const before = helmet.getHeaders()["content-security-policy"];

    helmet.addCspSource("img-src", "https://img.example.com");

    const after = helmet.getHeaders()["content-security-policy"];
    expect(after).not.toBe(before);
    expect(parse(after)["img-src"]).toContain("https://img.example.com");
  });

  it("hashes an inline script as the browser does: SHA-256 of its exact bytes, base64", ({
    expect,
  }) => {
    const { helmet } = appWith({ contentSecurityPolicy: {} });
    const script = 'console.log("é")';

    const source = helmet.addCspScriptHash(script);

    const expected = createHash("sha256").update(script).digest("base64");
    expect(source).toBe(`'sha256-${expected}'`);
    expect(helmet.isCspScriptHashed(script)).toBe(true);
    expect(helmet.isCspScriptHashed(`${script} `)).toBe(false);
    expect(
      parse(helmet.getHeaders()["content-security-policy"])["script-src"],
    ).toEqual(["'self'", source]);
  });

  it("sends the registered sources on a response", async ({ expect }) => {
    const { alepha, helmet } = appWith({ contentSecurityPolicy: {} });
    helmet.addCspSource("connect-src", "https://api.example.com");
    await alepha.start();
    try {
      const response = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/ping`,
      );
      expect(
        parse(response.headers.get("content-security-policy") ?? "")[
          "connect-src"
        ],
      ).toEqual(["'self'", "https://api.example.com"]);
    } finally {
      await alepha.stop();
    }
  });
});
