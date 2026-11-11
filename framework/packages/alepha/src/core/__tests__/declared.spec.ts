import {
  $hook,
  $inject,
  $module,
  Alepha,
  type AppSurface,
  ContainerLockedError,
} from "alepha";
import { $action, AlephaServer, ServerRouterProvider } from "alepha/server";
import { describe, it } from "vitest";

/**
 * A build list calling the given keys pure, the way `alepha build` writes it.
 */
const listOf = (...pure: string[]): AppSurface => ({
  version: 1,
  classes: pure.map((key) => ({ key, pure: true })),
  actions: [],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
});

describe("declared classes and the lock", () => {
  it("declares a pure class listed in services or passed to alepha.with, and creates one passed to alepha.inject", ({
    expect,
  }) => {
    class Listed {
      a = $action({ method: "GET", path: "/listed", handler: () => "" });
    }
    class Withed {
      a = $action({ method: "GET", path: "/withed", handler: () => "" });
    }
    class Injected {
      a = $action({ method: "GET", path: "/injected", handler: () => "" });
    }
    const alepha = Alepha.create()
      .with(AlephaServer)
      .useSurface(listOf("test.forms:Listed", "Withed", "Injected"))
      .with(
        $module({
          name: "test.forms",
          services: [Listed],
          register: (it) => {
            it.with(Withed);
            it.inject(Injected);
          },
        }),
      );

    expect(alepha.isDeclared(Listed)).toBe(true);
    expect(alepha.isDeclared(Withed)).toBe(true);
    expect(alepha.has(Listed)).toBe(false);
    expect(alepha.has(Withed)).toBe(false);
    expect(alepha.has(Injected)).toBe(true);
  });

  it("creates at once without a list, or for a class the list does not call pure", ({
    expect,
  }) => {
    class A {
      a = $action({ method: "GET", path: "/a", handler: () => "" });
    }
    class B {
      b = $action({ method: "GET", path: "/b", handler: () => "" });
    }
    const noList = Alepha.create().with(A);
    expect(noList.has(A)).toBe(true);

    const other = Alepha.create()
      .with(AlephaServer)
      .useSurface(listOf("A"))
      .with(B);
    expect(other.has(B)).toBe(true);
  });

  it("creates a declared class once on its first inject after start, running its primitives", async ({
    expect,
  }) => {
    let constructed = 0;
    class Api {
      a = $action({ method: "GET", path: "/late", handler: () => "late" });
      constructor() {
        constructed++;
      }
    }
    const alepha = Alepha.create()
      .with(AlephaServer)
      .useSurface(listOf("Api"))
      .with(Api);
    await alepha.start();
    expect(constructed).toBe(0);

    const first = alepha.inject(Api);
    const second = alepha.inject(Api);
    expect(first).toBe(second);
    expect(constructed).toBe(1);
    expect(alepha.isDeclared(Api)).toBe(false);
    expect(
      alepha
        .inject(ServerRouterProvider)
        .getRoutes()
        .some((it) => it.path.endsWith("/late")),
    ).toBe(true);
    await alepha.stop();
  });

  it("still refuses a class no module declared after start", async ({
    expect,
  }) => {
    class Unknown {}
    const alepha = Alepha.create();
    await alepha.start();
    expect(() => alepha.inject(Unknown)).toThrow(ContainerLockedError);
    await alepha.stop();
  });

  it("admits what a declared class creates while it is created late, at any depth, and refuses the same class from a handler", async ({
    expect,
  }) => {
    class Deep {}
    class Middle {
      deep = $inject(Deep);
    }
    class Api {
      middle = $inject(Middle);
      a = $action({ method: "GET", path: "/deep", handler: () => "" });
    }
    class Stray {}
    const alepha = Alepha.create()
      .with(AlephaServer)
      .useSurface(listOf("Api"))
      .with(Api);
    await alepha.start();

    expect(alepha.inject(Api).middle.deep).toBeInstanceOf(Deep);
    expect(() => alepha.inject(Stray)).toThrow(ContainerLockedError);
    await alepha.stop();
  });

  it("never creates a class holding a $hook late: refused, naming the class and the primitive", async ({
    expect,
  }) => {
    class Hooked {
      a = $action({ method: "GET", path: "/hooked", handler: () => "" });
      boot = $hook({ on: "start", handler: () => {} });
    }
    // A stale list calling it pure: the runtime refusal is the second line.
    const alepha = Alepha.create()
      .with(AlephaServer)
      .useSurface(listOf("Hooked"))
      .with(Hooked);
    await alepha.start();

    expect(() => alepha.inject(Hooked)).toThrow(/Hooked.*\$hook.*boot/);
    await alepha.stop();
  });

  it("creates a class holding a $hook at boot when the list does not call it pure", ({
    expect,
  }) => {
    class Hooked {
      a = $action({ method: "GET", path: "/hooked-boot", handler: () => "" });
      boot = $hook({ on: "start", handler: () => {} });
    }
    const alepha = Alepha.create()
      .with(AlephaServer)
      .useSurface(listOf())
      .with(Hooked);
    expect(alepha.has(Hooked)).toBe(true);
  });

  it("replaces a placeholder route with the real one when the class is created late", async ({
    expect,
  }) => {
    class Api {
      a = $action({ method: "GET", path: "/swap", handler: () => "real" });
    }
    const alepha = Alepha.create()
      .with(AlephaServer)
      .useSurface(listOf("Api"))
      .with(Api);
    const router = alepha.inject(ServerRouterProvider);
    router.createRoute({
      method: "GET",
      path: "/api/swap",
      placeholder: true,
      handler: () => "placeholder",
    });
    await alepha.start();

    alepha.inject(Api);
    const routes = router.getRoutes().filter((it) => it.path === "/api/swap");
    expect(routes).toHaveLength(1);
    expect(routes[0].placeholder).toBeUndefined();
    await alepha.stop();
  });
});
