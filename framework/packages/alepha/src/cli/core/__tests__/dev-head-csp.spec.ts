import { createHash } from "node:crypto";

import react from "@vitejs/plugin-react";
import { Alepha } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import {
  AlephaServer,
  helmetOptions,
  ServerHelmetProvider,
} from "alepha/server";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  type DevServerOptions,
  ViteDevServerProvider,
} from "../providers/ViteDevServerProvider.ts";

/**
 * The dev head of a real Vite server with the React plugin: its own inline
 * scripts plus the plugin's refresh preamble.
 */
class HeadProvider extends ViteDevServerProvider {
  public async head(server: ViteDevServer, options: Partial<DevServerOptions>) {
    this.options = options as DevServerOptions;
    this.server = server;
    return this.generateDevHead();
  }
}

describe("alepha dev under the CSP", () => {
  let vite: ViteDevServer;
  beforeAll(async () => {
    vite = await createServer({
      root: process.cwd(),
      logLevel: "silent",
      configFile: false,
      server: { middlewareMode: true },
      plugins: [react()],
      optimizeDeps: { noDiscovery: true, include: [] },
    });
  });
  afterAll(async () => {
    await vite?.close();
  });

  const hashOf = (body: string) =>
    `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

  it("allows every inline script of the dev head by its hash, the plugin's included", async ({
    expect,
  }) => {
    const devHead = await Alepha.create()
      .inject(HeadProvider)
      .head(vite, {
        entry: {
          root: "/app",
          server: "src/main.server.ts",
          style: "src/main.css",
        },
        define: { __APP_CONFIG__: '{"mode":"dev"}' },
      } as never);
    expect(devHead).toContain("injectIntoGlobalHook");

    class App {
      home = $page({ path: "/", component: () => null });
    }
    const app = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(AlephaReactRouter)
      .with(App);
    app.store.mut(helmetOptions, (old) => ({
      ...old,
      contentSecurityPolicy: {},
    }));
    // What ViteDevServerProvider does with the head it generated.
    app.store.set("alepha.react.ssr.manifest", { devHead });
    await app.start();
    try {
      const policy =
        app.inject(ServerHelmetProvider).getHeaders()[
          "content-security-policy"
        ] ?? "";
      const bodies = [
        ...devHead.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g),
      ]
        .filter(([, attrs]) => !/\bsrc=/.test(attrs))
        .map(([, , body]) => body)
        .filter(Boolean);

      // The refresh preamble, the reload handler, the stylesheet import, the
      // define constant: at least four.
      expect(bodies.length).toBeGreaterThanOrEqual(4);
      for (const body of bodies) {
        expect(policy, body.slice(0, 60)).toContain(hashOf(body));
      }
    } finally {
      await app.stop();
    }
  });
});
