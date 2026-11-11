import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";
import { WebSocketServer } from "ws";

/**
 * `$proxy({ websocket: true })` on workerd (#Q3351): the upgrade is a routed
 * request, and the upstream's 101 goes back to the client as is, its
 * `webSocket` included. The credential default of #Q3322 applies, and with
 * `forward: ["authorization"]` the bearer `ServerAuthProvider` derives from
 * the session cookie is the one a Node handshake sends
 * (`$proxy-websocket.spec.ts` stubs the same two methods).
 */
describe("$proxy websocket (workerd)", () => {
  it("forwards the upgrade, pipes frames both ways and sends the same credentials as Node", async ({
    expect,
  }) => {
    // The upstream: a `ws` echo server on Node, recording each handshake.
    const handshakes: IncomingHttpHeaders[] = [];
    const urls: string[] = [];
    const http = createServer();
    const wss = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
      handshakes.push(req.headers);
      urls.push(req.url ?? "");
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) =>
          ws.send(`echo:${(data as Buffer).toString()}`),
        );
      });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

    const dir = await mkdtemp(join(tmpdir(), "alepha-proxy-ws-"));
    const entry = join(
      process.cwd(),
      "node_modules/.alepha/proxy-websocket-runtime.ts",
    );
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { Alepha, run } from "alepha";
import { AlephaServerAuth, ServerAuthProvider } from "alepha/server/auth";
import { $proxy } from "alepha/server/proxy";
class StubSessionAuth extends ServerAuthProvider {
 async cookiesToTokens(cookies) {
  const value = cookies.req.tokens;
  return value ? { access_token: "token-of:" + value } : undefined;
 }
 extractAccessToken(tokens) { return tokens.access_token; }
}
class Front {
 bare = $proxy({
  path: "/bare/*",
  target: ${JSON.stringify(target)},
  websocket: true,
  rewrite: (url) => { url.pathname = url.pathname.replace("/bare", ""); },
 });
 authed = $proxy({
  path: "/authed/*",
  target: ${JSON.stringify(target)},
  websocket: true,
  forward: ["authorization"],
  rewrite: (url) => { url.pathname = url.pathname.replace("/authed", ""); },
 });
}
const app = run(
 Alepha.create()
  .with({ provide: ServerAuthProvider, use: StubSessionAuth })
  .with(AlephaServerAuth)
  .with(Front),
);
export default { async fetch(request) {
 await app.start();
 const ctx = { req: request };
 await app.events.emit("web:request:before", ctx);
 return ctx.res ?? new Response("no response", { status: 500 });
} };
`,
    );

    let runtime: Miniflare | undefined;
    try {
      await build({
        configFile: false,
        publicDir: false,
        logLevel: "silent",
        ssr: {
          noExternal: true,
          resolve: { conditions: ["workerd", "module"] },
        },
        build: {
          ssr: entry,
          outDir: dir,
          emptyOutDir: false,
          minify: false,
          rolldownOptions: {
            external: [/^cloudflare:/, /^node:/],
            output: {
              entryFileNames: "worker.js",
              codeSplitting: false,
              format: "esm",
            },
          },
        },
      });
      const script = await readFile(join(dir, "worker.js"), "utf8");
      runtime = new Miniflare({
        port: 0,
        telemetry: { enabled: false },
        workers: [
          {
            config: {
              name: "proxy-websocket-fixture",
              compatibilityDate: "2026-11-03",
              compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
            },
          },
        ],
      });

      const connect = async (path: string, headers: Record<string, string>) => {
        const response = await runtime!.dispatchFetch(
          `http://front.test${path}`,
          { headers: { upgrade: "websocket", ...headers } },
        );
        expect(response.status).toBe(101);
        const socket = response.webSocket!;
        socket.accept();
        return socket;
      };
      const roundTrip = (
        socket: NonNullable<Awaited<ReturnType<typeof connect>>>,
        text: string,
      ) =>
        new Promise<string>((resolve) => {
          socket.addEventListener(
            "message",
            (event) => resolve(event.data as string),
            { once: true },
          );
          socket.send(text);
        });

      // Default: frames both ways, neither credential upstream.
      const bare = await connect("/bare/feed?x=1", {
        cookie: "tokens=abc",
        authorization: "Bearer client",
        "x-other": "kept",
      });
      expect(await roundTrip(bare, "hello")).toBe("echo:hello");
      expect(await roundTrip(bare, "again")).toBe("echo:again");
      bare.close();
      expect(urls[0]).toBe("/feed?x=1");
      expect(handshakes[0].cookie).toBeUndefined();
      expect(handshakes[0].authorization).toBeUndefined();
      expect(handshakes[0]["x-other"]).toBe("kept");

      // forward: ["authorization"]: the cookie-derived bearer, the same
      // value the Node spec observes for the same cookie.
      const authed = await connect("/authed/feed", { cookie: "tokens=abc" });
      expect(await roundTrip(authed, "ok")).toBe("echo:ok");
      authed.close();
      expect(handshakes[1].authorization).toBe("Bearer token-of:abc");
      expect(handshakes[1].cookie).toBeUndefined();
    } finally {
      await runtime?.dispose();
      wss.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
