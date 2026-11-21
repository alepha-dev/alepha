import {
  createServer,
  type IncomingHttpHeaders,
  request as httpRequest,
  type ClientRequest,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync, zstdCompressSync } from "node:zlib";

import { $hook, Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

import { $proxy, ServerProxyProvider } from "../index.ts";

/**
 * The headers a `$proxy` must not carry across: the hop-by-hop ones of the
 * client's connection (RFC 9110 section 7.6.1), and the encoding of a body
 * `fetch` already decoded.
 *
 * Driven with `node:http` on both sides: `fetch` refuses to send most of
 * these headers and decodes what it receives, so it can show neither.
 */
describe("$proxy hop-by-hop and encoding headers", () => {
  let upstream: Server;
  let alepha: Alepha;
  let base: URL;

  const small = "hello hello hello hello";
  const big = "a".repeat(5000);

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (req.url === "/small" || req.url === "/big") {
          const body = gzipSync(req.url === "/small" ? small : big);
          res.writeHead(200, {
            "content-type": "text/plain",
            "content-encoding": "gzip",
            "content-length": body.length,
          });
          res.end(body);
          return;
        }
        if (req.url === "/zstd" || req.url === "/gzip-zstd") {
          const body =
            req.url === "/zstd"
              ? zstdCompressSync(big)
              : zstdCompressSync(gzipSync(big));
          res.writeHead(200, {
            "content-type": "text/plain",
            "content-encoding": req.url === "/zstd" ? "zstd" : "gzip, zstd",
            "content-length": body.length,
          });
          res.end(body);
          return;
        }
        if (req.url === "/unknown") {
          // A coding no `fetch` decodes: the bytes arrive as sent.
          res.writeHead(200, {
            "content-type": "text/plain",
            "content-encoding": "x-unknown",
            "content-length": small.length,
          });
          res.end(small);
          return;
        }
        if (req.url === "/cookies") {
          res.writeHead(200, {
            "content-type": "text/plain",
            "set-cookie": ["a=1", "b=2"],
            connection: "X-Up-Hop",
            "x-up-hop": "private to the upstream connection",
            "x-kept": "yes",
          });
          res.end("ok");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            headers: req.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    class Front {
      proxy = $proxy({
        path: "/up/*",
        target,
        rewrite: (url) => {
          url.pathname = url.pathname.replace("/up", "");
        },
      });
    }
    class Session {
      // What `ServerAuthProvider` does for a signed-in browser.
      session = $hook({
        on: "server:request:before",
        handler: ({ request }) => {
          if (request.headers.cookie && !request.headers.authorization) {
            request.headers.authorization = "Bearer session-access-token";
          }
        },
      });

      forwarding = $proxy({
        path: "/fwd/*",
        target,
        forward: ["authorization"],
        rewrite: (url) => {
          url.pathname = url.pathname.replace("/fwd", "");
        },
      });
    }
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(Front)
      .with(Session);
    await alepha.start();
    base = new URL(alepha.inject(ServerProvider).hostname);
  });

  afterAll(async () => {
    await alepha.stop();
    await new Promise((resolve) => upstream.close(resolve));
  });

  interface RawAnswer {
    status: number | string;
    headers: IncomingHttpHeaders;
    body: Buffer;
  }

  /**
   * One request to the proxy. Settles on the complete answer, or says how it
   * failed to complete: an answer cut short is the bug under test.
   */
  const raw = (
    options: {
      path: string;
      method?: string;
      headers?: Record<string, string | number>;
    },
    write?: (req: ClientRequest) => void,
  ) =>
    new Promise<RawAnswer>((resolve) => {
      const req = httpRequest(
        { hostname: base.hostname, port: base.port, ...options },
        (res) => {
          const chunks: Buffer[] = [];
          const settle = (status: number | string) => {
            clearTimeout(timer);
            resolve({
              status,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
            req.destroy();
          };
          const timer = setTimeout(() => settle("incomplete after 3s"), 3000);
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => settle(res.statusCode ?? 0));
          res.on("error", (error: NodeJS.ErrnoException) =>
            settle(`error ${error.code}`),
          );
        },
      );
      req.on("error", (error: NodeJS.ErrnoException) =>
        resolve({
          status: `error ${error.code}`,
          headers: {},
          body: Buffer.from(""),
        }),
      );
      if (write) {
        write(req);
      } else {
        req.end();
      }
    });

  const echoed = (answer: RawAnswer) =>
    JSON.parse(answer.body.toString()) as {
      headers: Record<string, string>;
      body: string;
    };

  describe("request side", () => {
    it("forwards a body sent with Transfer-Encoding: chunked", async ({
      expect,
    }) => {
      const answer = await raw(
        {
          path: "/up/echo",
          method: "POST",
          headers: { "content-type": "text/plain" },
        },
        (req) => {
          req.write("part1-");
          req.end("part2");
        },
      );

      expect(answer.status).toBe(200);
      expect(echoed(answer).body).toBe("part1-part2");
    });

    it("forwards a body sent with Content-Length", async ({ expect }) => {
      const answer = await raw(
        {
          path: "/up/echo",
          method: "POST",
          headers: { "content-type": "text/plain", "content-length": 5 },
        },
        (req) => req.end("hello"),
      );

      expect(answer.status).toBe(200);
      expect(echoed(answer).body).toBe("hello");
    });

    it("does not forward Keep-Alive", async ({ expect }) => {
      const answer = await raw({
        path: "/up/echo",
        headers: { "keep-alive": "timeout=5", "x-other": "kept" },
      });

      expect(answer.status).toBe(200);
      expect(echoed(answer).headers["x-other"]).toBe("kept");
    });

    it("does not forward Upgrade on a proxy without websocket", async ({
      expect,
    }) => {
      const answer = await raw({
        path: "/up/echo",
        headers: { upgrade: "foo", "x-other": "kept" },
      });

      expect(answer.status).toBe(200);
      expect(echoed(answer).headers.upgrade).toBeUndefined();
      expect(echoed(answer).headers["x-other"]).toBe("kept");
    });

    it("does not forward TE, Proxy-Connection, Proxy-Authorization nor a header Connection names", async ({
      expect,
    }) => {
      const answer = await raw({
        path: "/up/echo",
        headers: {
          connection: "keep-alive, X-Hop",
          "x-hop": "private to this connection",
          te: "trailers",
          "proxy-connection": "keep-alive",
          "proxy-authorization": "Basic abc",
          "x-other": "kept",
        },
      });

      expect(answer.status).toBe(200);
      const { headers } = echoed(answer);
      expect(headers["x-hop"]).toBeUndefined();
      expect(headers.te).toBeUndefined();
      expect(headers["proxy-connection"]).toBeUndefined();
      expect(headers["proxy-authorization"]).toBeUndefined();
      expect(headers["x-other"]).toBe("kept");
    });
  });

  describe("request side, beyond hop-by-hop", () => {
    it("does not forward Expect: 100-continue, which the proxy already answered", async ({
      expect,
    }) => {
      const answer = await raw(
        {
          path: "/up/echo",
          method: "POST",
          headers: {
            "content-type": "text/plain",
            "content-length": 5,
            expect: "100-continue",
          },
        },
        (req) => req.end("hello"),
      );

      expect(answer.status).toBe(200);
      expect(echoed(answer).body).toBe("hello");
      expect(echoed(answer).headers.expect).toBeUndefined();
    });

    it("forwards the credential forward names", async ({ expect }) => {
      const answer = await raw({
        path: "/fwd/echo",
        headers: { cookie: "session=abc" },
      });

      expect(echoed(answer).headers.authorization).toBe(
        "Bearer session-access-token",
      );
    });

    it("drops a header the client names in Connection, a forwarded credential included", async ({
      expect,
    }) => {
      // A client can only withhold what is its own to send: the upstream sees
      // the request an anonymous caller would have made.
      const answer = await raw({
        path: "/fwd/echo",
        headers: {
          cookie: "session=abc",
          connection: "keep-alive, Authorization",
          "x-other": "kept",
        },
      });

      expect(answer.status).toBe(200);
      expect(echoed(answer).headers.authorization).toBeUndefined();
      expect(echoed(answer).headers["x-other"]).toBe("kept");
    });
  });

  describe("response side", () => {
    it("keeps every Set-Cookie and drops the upstream's hop-by-hop headers", async ({
      expect,
    }) => {
      const answer = await raw({ path: "/up/cookies" });

      expect(answer.status).toBe(200);
      expect(answer.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
      expect(answer.headers["x-up-hop"]).toBeUndefined();
      expect(answer.headers["x-kept"]).toBe("yes");
    });

    for (const [path, text] of [
      ["/up/small", small],
      ["/up/big", big],
    ] as const) {
      it(`answers the decoded body of an upstream that compressed ${path} anyway, without its encoding headers`, async ({
        expect,
      }) => {
        const answer = await raw({
          path,
          headers: { "accept-encoding": "identity" },
        });

        expect(answer.status).toBe(200);
        expect(answer.headers["content-encoding"]).toBeUndefined();
        expect(answer.body.toString()).toBe(text);
        if (answer.headers["content-length"] !== undefined) {
          expect(Number(answer.headers["content-length"])).toBe(text.length);
        }
      });
    }

    for (const path of ["/up/zstd", "/up/gzip-zstd"]) {
      it(`answers the decoded body of ${path} too, without its encoding headers`, async ({
        expect,
      }) => {
        const answer = await raw({
          path,
          headers: { "accept-encoding": "identity" },
        });

        expect(answer.status).toBe(200);
        expect(answer.headers["content-encoding"]).toBeUndefined();
        expect(answer.body.toString()).toBe(big);
      });
    }

    it("passes a coding fetch does not decode through untouched", async ({
      expect,
    }) => {
      const answer = await raw({ path: "/up/unknown" });

      expect(answer.status).toBe(200);
      expect(answer.headers["content-encoding"]).toBe("x-unknown");
      expect(answer.headers["content-length"]).toBe(String(small.length));
      expect(answer.body.toString()).toBe(small);
    });

    it("answers a HEAD with the encoding headers the GET carries", async ({
      expect,
    }) => {
      const get = await raw({ path: "/up/big" });
      const head = await raw({ path: "/up/big", method: "HEAD" });

      expect(head.status).toBe(200);
      expect(head.body.length).toBe(0);
      expect(get.headers["content-encoding"]).toBeUndefined();
      expect(head.headers["content-encoding"]).toBe(
        get.headers["content-encoding"],
      );
      // The upstream's length is the compressed body's, which nobody receives.
      expect(head.headers["content-length"]).not.toBe(
        String(gzipSync(big).length),
      );
    });
  });

  describe("the codings fetch decodes, by runtime", () => {
    class TestProxyProvider extends ServerProxyProvider {
      public workerd = false;

      protected override isWorkerd(): boolean {
        return this.workerd;
      }

      public testWasDecoded(encoding: string, workerd: boolean): boolean {
        this.workerd = workerd;
        return this.wasDecoded(
          new Response(null, { headers: { "content-encoding": encoding } }),
        );
      }
    }

    const provider = () => Alepha.create().inject(TestProxyProvider);

    it("is gzip, x-gzip, deflate, br and zstd on Node and Bun", ({
      expect,
    }) => {
      const proxy = provider();

      for (const coding of ["gzip", "x-gzip", "deflate", "br", "zstd"]) {
        expect(proxy.testWasDecoded(coding, false), coding).toBe(true);
      }
      expect(proxy.testWasDecoded("GZIP, zstd", false)).toBe(true);
      expect(proxy.testWasDecoded("x-unknown", false)).toBe(false);
      expect(proxy.testWasDecoded("gzip, x-unknown", false)).toBe(false);
      expect(proxy.testWasDecoded("", false)).toBe(false);
    });

    it("is gzip and br only on workerd", ({ expect }) => {
      const proxy = provider();

      for (const coding of ["gzip", "br", "br, gzip"]) {
        expect(proxy.testWasDecoded(coding, true), coding).toBe(true);
      }
      for (const coding of ["x-gzip", "deflate", "zstd", "gzip, deflate"]) {
        expect(proxy.testWasDecoded(coding, true), coding).toBe(false);
      }
    });
  });
});
