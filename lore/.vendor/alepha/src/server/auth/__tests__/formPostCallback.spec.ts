import { Readable } from "node:stream";

import { Alepha } from "alepha";
import type { ServerRawRequest } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaServerAuth } from "../index.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * `handleCallback` switched to POST-body parsing only when `raw.web.req`
 * existed. The Node adapter carries an `IncomingMessage` and no web `Request`,
 * so on plain Node the authorization code was never read out of the body and
 * Apple Sign In (the one provider that uses `response_mode=form_post`) failed
 * outright — while working fine on workerd/Bun.
 */
class ProviderProbe extends ServerAuthProvider {
  public probe(url: URL, raw?: ServerRawRequest) {
    return this.toWebRequest(url, raw);
  }
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaServerAuth);
  alepha.with(ProviderProbe);
  await alepha.start();
  return alepha.inject(ProviderProbe);
};

/**
 * Minimal IncomingMessage stand-in: a Readable carrying method + headers.
 */
const nodeRequest = (body: string, headers: Record<string, string> = {}) => {
  const stream = Readable.from([Buffer.from(body)]) as any;
  stream.method = "POST";
  stream.headers = {
    "content-type": "application/x-www-form-urlencoded",
    ...headers,
  };
  return stream;
};

const url = new URL("https://app.example.com/auth/callback");

describe("form_post callback on the Node adapter", () => {
  it("builds a web Request carrying the POST body", async () => {
    const provider = await setup();

    const request = await provider.probe(url, {
      node: { req: nodeRequest("code=abc123&state=xyz"), res: {} as never },
    });

    expect(request).toBeDefined();
    expect(request?.method).toBe("POST");
    expect(await request?.text()).toBe("code=abc123&state=xyz");
  });

  it("preserves the request headers", async () => {
    const provider = await setup();

    const request = await provider.probe(url, {
      node: {
        req: nodeRequest("code=abc", { "x-forwarded-proto": "https" }),
        res: {} as never,
      },
    });

    expect(request?.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(request?.headers.get("x-forwarded-proto")).toBe("https");
  });

  it("exposes the body as form data, so the Apple `user` field is readable", async () => {
    const provider = await setup();

    const body = new URLSearchParams({
      code: "abc",
      user: JSON.stringify({
        name: { firstName: "Ada", lastName: "Lovelace" },
        email: "ada@example.com",
      }),
    }).toString();

    const request = await provider.probe(url, {
      node: { req: nodeRequest(body), res: {} as never },
    });

    const form = await request?.formData();
    expect(form?.get("code")).toBe("abc");
    // Test fixture: the body is a string the test just wrote.
    // oxlint-disable-next-line typescript/no-base-to-string
    expect(String(form?.get("user"))).toContain("Ada");
  });

  it("still prefers the web Request when the runtime provides one", async () => {
    const provider = await setup();
    const web = new Request(url, { method: "POST", body: "code=web" });

    const request = await provider.probe(url, { web: { req: web } });

    expect(request).toBe(web);
  });

  it("returns undefined for a GET callback so the query URL is used", async () => {
    const provider = await setup();

    const get = Readable.from([]) as any;
    get.method = "GET";
    get.headers = {};

    expect(
      await provider.probe(url, { node: { req: get, res: {} as never } }),
    ).toBeUndefined();
    expect(await provider.probe(url, undefined)).toBeUndefined();
  });
});
