import { createHash } from "node:crypto";

import { Alepha, z } from "alepha";
import { $head } from "alepha/react/head";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { AlephaServer, helmetOptions, ServerProvider } from "alepha/server";
import { Suspense, use } from "react";
import { describe, it } from "vitest";

import { AlephaReactUi } from "../index.ts";

/**
 * The constant inline scripts the framework writes into a document are
 * allowed by their SHA-256, and each hash in the header must match the
 * emitted bytes exactly: a single byte off and the browser blocks it.
 */
describe("CSP hashes of the framework's constant inline scripts", () => {
  const Slow = (props: { value: Promise<string> }) => (
    <output>{use(props.value)}</output>
  );

  class App {
    head = $head({
      script: [
        { content: "window.__appConstant=1" },
        { type: "application/ld+json", content: '{"@type":"Thing"}' },
      ],
    });

    home = $page({
      path: "/",
      component: () => <main>Home</main>,
    });

    deferred = $page({
      path: "/deferred",
      schema: { query: z.object({ ms: z.integer().default(100) }) },
      loader: async ({ query }) => ({
        value: new Promise<string>((resolve) => {
          setTimeout(() => resolve("Done"), query.ms);
        }),
      }),
      component: (props: { value: Promise<string> }) => (
        <main>
          <Suspense fallback={<p>Pending</p>}>
            <Slow value={props.value} />
          </Suspense>
        </main>
      ),
    });
  }

  const start = async () => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(AlephaReactRouter)
      .with(AlephaReactUi)
      .with(App);
    alepha.store.mut(helmetOptions, (old) => ({
      ...old,
      contentSecurityPolicy: {},
    }));
    await alepha.start();
    return { alepha, base: alepha.inject(ServerProvider).hostname };
  };

  const scriptSrc = (response: Response) =>
    (response.headers.get("content-security-policy") ?? "")
      .split(";")
      .map((it) => it.trim().split(/\s+/))
      .find(([name]) => name === "script-src")
      ?.slice(1) ?? [];

  /**
   * Every executable inline script of the document: no `src`, and no data
   * `type`. The bytes between the tags, as the browser hashes them.
   */
  const inlineScripts = (html: string) =>
    [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attrs]) => !/\bsrc=/.test(attrs))
      .filter(([, attrs]) => {
        const type = attrs.match(/\btype="([^"]*)"/)?.[1];
        return !type || type === "module";
      })
      .map(([, , body]) => body);

  const hashOf = (body: string) =>
    `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

  it("allows the colour scheme boot and a literal $head script on a page", async ({
    expect,
  }) => {
    const { alepha, base } = await start();
    try {
      const response = await fetch(`${base}/`);
      const html = await response.text();
      const allowed = scriptSrc(response);

      const scripts = inlineScripts(html);
      expect(scripts.some((it) => it.includes("alepha-ui"))).toBe(true);
      expect(scripts).toContain("window.__appConstant=1");
      for (const body of scripts) {
        expect(allowed, body.slice(0, 60)).toContain(hashOf(body));
      }
      // A data block is not governed by script-src, and is not hashed.
      expect(allowed).not.toContain(hashOf('{"@type":"Thing"}'));
    } finally {
      await alepha.stop();
    }
  });

  it("allows the boot signal of a streamed page by its hash", async ({
    expect,
  }) => {
    const { alepha, base } = await start();
    try {
      const response = await fetch(`${base}/deferred?ms=300`);
      const html = await response.text();
      const allowed = scriptSrc(response);

      const boot = inlineScripts(html).find((it) => it.includes("alepha:boot"));
      expect(boot).toBeDefined();
      expect(allowed).toContain(hashOf(boot as string));
    } finally {
      await alepha.stop();
    }
  });
});
