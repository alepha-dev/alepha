import {
  Alepha,
  createMiddleware,
  MIDDLEWARE_PROTECTED,
  type Middleware,
} from "alepha";
import { $secure } from "alepha/security";
import { describe, expect, it } from "vitest";
import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";
import { ReactPageProvider } from "../providers/ReactPageProvider.ts";

/**
 * A guarded page defaults to CSR.
 *
 * Server-rendering pays for HTML that only an authenticated visitor will ever
 * see — no crawler gets past the redirect — so a page behind a guard skips the
 * render by default and keeps its loader. These pin the precedence rules, which
 * are the part that is easy to get subtly wrong.
 */
const setup = () => Alepha.create().with(AlephaReactRouter);

const resolve = (alepha: Alepha, name: string): boolean => {
  const provider = alepha.inject(ReactPageProvider);
  const route = provider.getPages().find((it) => it.name === name);
  if (!route) {
    throw new Error(`route '${name}' not found`);
  }
  return provider.isSSR(route);
};

/**
 * An application's own auth middleware — declares the capability without being
 * `$secure`, which is the whole point of a flag over a name match.
 */
const $ownGuard = (): Middleware =>
  createMiddleware({
    name: "$ownGuard",
    meta: { [MIDDLEWARE_PROTECTED]: "true" },
    handler:
      ({ next }) =>
      async (...args: any[]) =>
        next(...args),
  });

describe("ssr derivation from guards", () => {
  it("server-renders an unguarded page", async () => {
    const alepha = setup();

    class App {
      home = $page({ path: "/", component: () => null });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "home")).toBe(true);
  });

  it("skips the render for a guarded page", async () => {
    const alepha = setup();

    class App {
      admin = $page({
        path: "/admin",
        use: [$secure()],
        component: () => null,
      });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "admin")).toBe(false);
  });

  it("recognises any middleware declaring the capability, not just $secure", async () => {
    const alepha = setup();

    class App {
      vault = $page({
        path: "/vault",
        use: [$ownGuard()],
        component: () => null,
      });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "vault")).toBe(false);
  });

  it("ignores a middleware that declares nothing", async () => {
    const alepha = setup();

    const $plain = (): Middleware =>
      createMiddleware({
        name: "$plain",
        handler:
          ({ next }) =>
          async (...args: any[]) =>
            next(...args),
      });

    class App {
      page = $page({ path: "/p", use: [$plain()], component: () => null });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "page")).toBe(true);
  });

  it("lets an explicit ssr:true beat its own guard", async () => {
    const alepha = setup();

    class App {
      // A page that is gated but still wants real HTML — e.g. it is linked
      // publicly and the guard only narrows what the loader returns.
      shared = $page({
        path: "/shared",
        ssr: true,
        use: [$secure()],
        component: () => null,
      });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "shared")).toBe(true);
  });

  it("puts the whole subtree of a guarded layout in CSR", async () => {
    const alepha = setup();

    class App {
      layout = $page({
        path: "/app",
        use: [$secure()],
        children: () => [this.inner],
      });

      inner = $page({ path: "/app/inner", component: () => null });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "inner")).toBe(false);
  });

  it("lets a child opt back into SSR under a guarded layout", async () => {
    const alepha = setup();

    class App {
      layout = $page({
        path: "/app",
        use: [$secure()],
        children: () => [this.landing],
      });

      // Public marketing page that happens to live under a guarded shell.
      landing = $page({
        path: "/app/landing",
        ssr: true,
        component: () => null,
      });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "landing")).toBe(true);
  });

  it("does not let a guarded child force its unguarded siblings to CSR", async () => {
    const alepha = setup();

    class App {
      layout = $page({ path: "/app", children: () => [this.a, this.b] });
      a = $page({ path: "/app/a", use: [$secure()], component: () => null });
      b = $page({ path: "/app/b", component: () => null });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "a")).toBe(false);
    expect(resolve(alepha, "b")).toBe(true);
  });

  it("keeps an explicit ssr:false on an unguarded page", async () => {
    const alepha = setup();

    class App {
      heavy = $page({ path: "/heavy", ssr: false, component: () => null });
    }

    alepha.inject(App);
    await alepha.start();

    expect(resolve(alepha, "heavy")).toBe(false);
  });

  it("takes the nearest decision when a guarded layout nests inside an ssr:true one", async () => {
    const alepha = setup();

    class App {
      root = $page({ path: "/r", ssr: true, children: () => [this.mid] });
      mid = $page({
        path: "/r/mid",
        use: [$secure()],
        children: () => [this.leaf],
      });
      leaf = $page({ path: "/r/mid/leaf", component: () => null });
    }

    alepha.inject(App);
    await alepha.start();

    // The guard is nearer to the leaf than the root's explicit `true`.
    expect(resolve(alepha, "leaf")).toBe(false);
  });
});
