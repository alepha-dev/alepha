import { createHash } from "node:crypto";

import { Alepha } from "alepha";
import { $head } from "alepha/react/head";
import { $action, AlephaServer, helmetOptions } from "alepha/server";
import { Suspense, use } from "react";
import { describe, type ExpectStatic, it } from "vitest";

import { $page, AlephaReactRouter, reactPageCacheOptions } from "../index.ts";

/**
 * The per-request CSP nonce (#Q3318): what no hash can cover carries it, and
 * it never reaches bytes two responses share.
 */
describe("CSP nonce", () => {
  const Slow = (props: { value: Promise<string> }) => (
    <output>{use(props.value)}</output>
  );

  class App {
    head = $head({ script: [{ content: "window.__constant=1" }] });

    ping = $action({ path: "/ping", method: "GET", handler: () => "pong" });

    plain = $page({
      path: "/plain",
      component: () => <main>Plain</main>,
    });

    dynamicHead = $page({
      path: "/dynamic-head",
      head: () => ({ script: [{ content: "window.__dynamic=1" }] }),
      component: () => <main>Dynamic</main>,
    });

    deferred = $page({
      path: "/deferred",
      loader: async () => ({
        value: new Promise<string>((resolve) => {
          setTimeout(() => resolve("Done"), 200);
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

    buffered = $page({
      path: "/buffered",
      stream: false,
      loader: async () => ({
        value: new Promise<string>((resolve) => {
          setTimeout(() => resolve("Done"), 20);
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

  const start = async (csp = true) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(AlephaReactRouter)
      .with(App);
    if (csp) {
      alepha.store.mut(helmetOptions, (old) => ({
        ...old,
        contentSecurityPolicy: {},
      }));
    }
    alepha.store.mut(reactPageCacheOptions, (it) => ({
      ...it,
      anonymousCheck: false,
    }));
    await alepha.start();
    return { alepha, app: alepha.inject(App) };
  };

  const scriptSrc = (response: Response) =>
    (response.headers.get("content-security-policy") ?? "")
      .split(";")
      .map((it) => it.trim().split(/\s+/))
      .find(([name]) => name === "script-src")
      ?.slice(1) ?? [];

  const nonceOf = (response: Response) =>
    scriptSrc(response)
      .find((it) => it.startsWith("'nonce-"))
      ?.slice("'nonce-".length, -1);

  /**
   * Every executable inline script, with its attributes.
   */
  const inlineScripts = (html: string) =>
    [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attrs]) => !/\bsrc=/.test(attrs))
      .filter(([, attrs]) => {
        const type = attrs.match(/\btype="([^"]*)"/)?.[1];
        return !type || type === "module";
      })
      .filter(([, , body]) => body !== "")
      .map(([, attrs, body]) => ({
        nonce: attrs.match(/\bnonce="([^"]*)"/)?.[1],
        body,
      }));

  const hashOf = (body: string) =>
    `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

  /**
   * The browser's rule: an inline script runs when its hash or its nonce is
   * in `script-src`.
   */
  const expectAllAllowed = (
    expect: ExpectStatic,
    response: Response,
    html: string,
  ) => {
    const allowed = scriptSrc(response);
    for (const script of inlineScripts(html)) {
      const ok =
        allowed.includes(hashOf(script.body)) ||
        (script.nonce !== undefined &&
          allowed.includes(`'nonce-${script.nonce}'`));
      expect(ok, script.body.slice(0, 80)).toBe(true);
    }
  };

  it("adds a nonce to script-src only, on a rendered page, a new one per request", async ({
    expect,
  }) => {
    const { alepha, app } = await start();
    try {
      const one = await app.plain.fetch({ html: true });
      const two = await app.dynamicHead.fetch({ html: true });
      const api = await fetch(`${new URL(one.response.url).origin}/api/ping`);

      expect(nonceOf(one.response)).toBeDefined();
      expect(nonceOf(two.response)).toBeDefined();
      expect(nonceOf(one.response)).not.toBe(nonceOf(two.response));
      expect(nonceOf(api)).toBeUndefined();
      expect(api.headers.get("content-security-policy")).not.toContain("nonce");
      const styleSrc = (
        one.response.headers.get("content-security-policy") ?? ""
      )
        .split(";")
        .find((it) => it.trim().startsWith("style-src"));
      expect(styleSrc).not.toContain("nonce");
      expect(styleSrc).toContain("'unsafe-inline'");
    } finally {
      await alepha.stop();
    }
  });

  it("writes a literal $head script bare and a $head function's with the nonce", async ({
    expect,
  }) => {
    const { alepha, app } = await start();
    try {
      const { html, response } = await app.dynamicHead.fetch({ html: true });
      const scripts = inlineScripts(html);
      const nonce = nonceOf(response);

      expect(
        scripts.find((it) => it.body === "window.__constant=1")?.nonce,
      ).toBeUndefined();
      expect(
        scripts.find((it) => it.body === "window.__dynamic=1")?.nonce,
      ).toBe(nonce);
      // A plain substring: a base64 nonce may hold `+` or `/`.
      expect(html).toContain(
        `<script id="__ssr_private" type="application/json" nonce="${nonce}">`,
      );
      expectAllAllowed(expect, response, html);
    } finally {
      await alepha.stop();
    }
  });

  it("allows every inline script of a streamed page: React's, the boot signal, the delivery", async ({
    expect,
  }) => {
    const { alepha, app } = await start();
    try {
      const { html, response } = await app.deferred.fetch({ html: true });
      const nonce = nonceOf(response);

      expect(html).toContain(">Done<");
      expect(html).toContain("__alephaDeferred");
      expect(
        inlineScripts(html).filter((it) => it.nonce === nonce).length,
      ).toBeGreaterThan(1);
      expectAllAllowed(expect, response, html);
    } finally {
      await alepha.stop();
    }
  });

  it("writes no delivery script in a buffered render", async ({ expect }) => {
    const { alepha, app } = await start();
    try {
      const buffered = await app.buffered.fetch({ html: true });
      const prerender = await app.deferred.render({ html: true });

      for (const html of [buffered.html, prerender.html]) {
        expect(html).toContain(">Done<");
        expect(html).not.toContain("__alephaDeferred");
      }
      // A prerender has no request, so no nonce anywhere.
      expect(prerender.html).not.toContain("nonce=");
    } finally {
      await alepha.stop();
    }
  });

  it("caches a page that carries no nonce, and a hit carries none either", async ({
    expect,
  }) => {
    const { alepha, app } = await start();
    try {
      const first = await app.plain.fetch({ html: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const hit = await app.plain.fetch({ html: true });

      expect(first.response.headers.get("x-alepha-cache")).toContain("miss");
      expect(hit.response.headers.get("x-alepha-cache")).toContain("hit");
      expect(nonceOf(first.response)).toBeDefined();
      // The hit's header is the static policy, and its bytes hold no nonce:
      // what the workerd edge tier stores is this response.
      expect(nonceOf(hit.response)).toBeUndefined();
      expect(hit.html).not.toContain("nonce=");
      expect(hit.html).not.toContain(nonceOf(first.response) as string);
      expectAllAllowed(expect, hit.response, hit.html);
    } finally {
      await alepha.stop();
    }
  });

  it("never stores a page whose markup carries the nonce", async ({
    expect,
  }) => {
    const { alepha, app } = await start();
    try {
      const first = await app.dynamicHead.fetch({ html: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await app.dynamicHead.fetch({ html: true });

      expect(first.html).toContain(`nonce="${nonceOf(first.response)}"`);
      expect(second.response.headers.get("x-alepha-cache")).toContain("miss");
      expect(nonceOf(second.response)).not.toBe(nonceOf(first.response));
    } finally {
      await alepha.stop();
    }
  });

  it("asks for no nonce when the CSP is off", async ({ expect }) => {
    const { alepha, app } = await start(false);
    try {
      const { html, response } = await app.deferred.fetch({ html: true });

      expect(response.headers.get("content-security-policy")).toBeNull();
      expect(html).not.toContain("nonce=");
      expect(html).toContain("__alephaDeferred");
    } finally {
      await alepha.stop();
    }
  });
});
