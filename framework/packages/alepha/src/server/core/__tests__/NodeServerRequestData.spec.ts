import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { NodeServerRequestData } from "../helpers/NodeServerRequestData.ts";
import type { ServerRequest } from "../interfaces/ServerRequest.ts";
import { ServerLoggerProvider } from "../providers/ServerLoggerProvider.ts";
import { ServerRequestParser } from "../services/ServerRequestParser.ts";

/**
 * A Node request parses its URL only when something reads it, and the
 * request log line takes its path from the raw request line when that gives
 * the same text. Both are checked here against what the eager code did:
 * `new URL(raw, base)`, and the path logged from that URL.
 */
class TestServerLoggerProvider extends ServerLoggerProvider {
  public fromUrl = (url: URL) => this.loggedPath(url);
  public fromRequest = (request: ServerRequest) => this.requestPath(request);
}

const targets = [
  "/",
  "/api/users/42",
  "/api/users/42?expand=true",
  "/a?",
  "/a?x=1&x=2",
  "/oauth/callback?code=abc&state=xyz",
  "/a?token=s3cret&page=2",
  "/.well-known/openid-configuration",
  "/a/./b",
  "/a/../b",
  "/a/%2e%2E/b",
  "//evil.example/x",
  "/a b",
  "/a?q=a b",
  "/a?q='quoted'",
  "/a/'x'",
  "/a/{b}",
  "/a\\b",
  "/caf%C3%A9",
  "/café",
  "/a?q=%zz",
  "http://other.example/abs?x=1",
];

const bases = ["http://127.0.0.1:3000", "https://example.com"];

const data = (rawUrl: string, base: string) =>
  new NodeServerRequestData({
    method: "GET",
    rawUrl,
    base,
    headers: {},
    query: {},
    params: {},
    signal: new AbortController().signal,
    raw: { node: { req: { url: rawUrl }, res: {} } as any },
  });

describe("NodeServerRequestData", () => {
  for (const base of bases) {
    for (const raw of targets) {
      it(`parses ${raw} on ${base} as new URL(raw, base) did`, ({ expect }) => {
        const lazy = data(raw, base);
        const eager = new URL(raw, base);

        expect(lazy.scheme).toBe(eager.protocol);
        expect(lazy.url.href).toBe(eager.href);
      });
    }
  }

  it("parses its URL once, on first read", ({ expect }) => {
    const lazy = data("/a?b=1", "http://h");

    expect(lazy.url).toBe(lazy.url);
  });

  it("keeps the request's url through a spread copy, as a plain field did", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerRequestParser);
    const request = parser.createServerRequest(data("/a?b=1", "http://h"));

    // SSR's anonymous render copies the request this way.
    const copy = { ...request, headers: {} };

    expect(copy.url.href).toBe("http://h/a?b=1");
  });
});

describe("ServerLoggerProvider request path", () => {
  const alepha = Alepha.create();
  const logger = alepha.inject(TestServerLoggerProvider);

  for (const raw of targets) {
    it(`logs ${raw} as the URL-derived path did`, ({ expect }) => {
      const request = data(raw, "http://127.0.0.1:3000");
      const viaUrl = logger.fromUrl(new URL(raw, "http://127.0.0.1:3000"));

      expect(
        logger.fromRequest({
          raw: request.raw,
          url: request.url,
        } as unknown as ServerRequest),
      ).toBe(viaUrl);
    });
  }

  it("never parses the URL of a plain target", ({ expect }) => {
    const request = {
      raw: { node: { req: { url: "/api/users/42?expand=true" } } },
      get url(): URL {
        throw new Error("the URL was parsed");
      },
    } as unknown as ServerRequest;

    expect(logger.fromRequest(request)).toBe("/api/users/42?expand=true");
  });
});
