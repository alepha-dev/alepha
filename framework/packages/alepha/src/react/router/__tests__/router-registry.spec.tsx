import { Alepha, z } from "alepha";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { LinkProps } from "../components/Link.tsx";
import { $page } from "../index.ts";
import type {
  ReactRouter,
  RegisteredRouter,
  RouterOf,
  RouterPageName,
} from "../services/ReactRouter.ts";

/**
 * The router registry (#Q3187): an app registers its routers once, and
 * `useRouter()` and `<Link>` are typed with no type argument.
 *
 * ⚠️ Nothing here augments `Routers` itself: an augmentation in a spec is
 * global to the program and would type every bare `useRouter()` in the
 * framework against this file's pages. `RouterOf` is what `RegisteredRouter`
 * applies to `Routers`, so these test it on a local registry instead.
 */
class CoreRouter {
  home = $page({ path: "/", component: () => "home" });
  project = $page({
    path: "/projects/:projectId",
    schema: { params: z.object({ projectId: z.text() }) },
    component: () => "project",
  });
}

class WorkRouter {
  quest = $page({
    path: "/projects/:projectId/quests/:questId",
    schema: {
      params: z.object({ projectId: z.text(), questId: z.text() }),
    },
    component: () => "quest",
  });
}

type Registered = RouterOf<{ core: CoreRouter; work: WorkRouter }>;

/**
 * Routers as apps write them: each holds a `protected` member of the same
 * name. Intersecting the classes themselves reduces to `never`.
 */
class GuardedCoreRouter {
  protected readonly alepha = Alepha.create();
  home = $page({ path: "/", component: () => "home" });
}

class GuardedWorkRouter {
  protected readonly alepha = Alepha.create();
  board = $page({ path: "/board", component: () => "board" });
}

describe("the router registry, at the type level", () => {
  it("is untyped while nothing is registered", () => {
    expectTypeOf<RouterOf<{}>>().toBeAny();
    // The framework's own program registers nothing.
    expectTypeOf<RegisteredRouter>().toBeAny();
  });

  it("joins every registered router's pages", () => {
    expectTypeOf<RouterPageName<Registered>>().toEqualTypeOf<
      "home" | "project" | "quest"
    >();
  });

  it("joins routers that each declare the same protected member", () => {
    type Guarded = RouterOf<{
      core: GuardedCoreRouter;
      work: GuardedWorkRouter;
    }>;
    expectTypeOf<Guarded>().not.toBeNever();
    expectTypeOf<RouterPageName<Guarded>>().toEqualTypeOf<"home" | "board">();
  });

  /**
   * The router answers to a page's `name`, not to the property holding it:
   * a shared router's `profile = $page({ name: "accountProfile" })` is
   * `accountProfile`, and `profile` throws at runtime.
   */
  it("names a page by its declared name, not its property key", () => {
    class NamedRouter {
      profile = $page({
        name: "accountProfile",
        path: "/account/profile",
        component: () => "profile",
      });
      home = $page({ path: "/", component: () => "home" });
    }
    expectTypeOf<RouterPageName<NamedRouter>>().toEqualTypeOf<
      "accountProfile" | "home"
    >();
  });

  it("types navigation on the joined router", () => {
    // Never called: the compiler reads these, the test only has to exist.
    const check = (router: ReactRouter<Registered>) => {
      void router.push("home");
      void router.push("quest", { params: { projectId: "1", questId: "2" } });
      void router.push("/anywhere");
      // @ts-expect-error a page no registered router has
      void router.push("folio");
      // @ts-expect-error a page from the second router keeps its params
      void router.push("quest", { params: { projectId: "1" } });
    };
    expect(check).toBeTypeOf("function");
  });
});

describe("Link props, at the type level", () => {
  it("takes a page name with its params, or a path", () => {
    const ok: Array<
      | LinkProps<"home", Registered>
      | LinkProps<"project", Registered>
      | LinkProps<"/about", Registered>
    > = [
      { href: "home" },
      { href: "project", params: { projectId: "42" } },
      { href: "/about", query: { tab: "a" }, prefetch: "hover" },
    ];
    expect(ok).toHaveLength(3);
  });

  it("refuses a name no page has, missing params, and params on a path", () => {
    // @ts-expect-error a misspelled page name
    const misspelled: LinkProps<"proejct", Registered> = { href: "proejct" };
    // @ts-expect-error the page's schema requires projectId
    const missing: LinkProps<"project", Registered> = { href: "project" };
    const wrong: LinkProps<"project", Registered> = {
      href: "project",
      // @ts-expect-error a param the page does not declare
      params: { id: "42" },
    };
    const onPath: LinkProps<"/about", Registered> = {
      href: "/about",
      // @ts-expect-error params belong to a page name, not to a path
      params: { id: "42" },
    };
    expect([misspelled, missing, wrong, onPath]).toHaveLength(4);
  });

  /**
   * A library's `<Link href={item.href}>` is compiled by every app that
   * imports it. A computed string cannot be checked, so it is taken and the
   * router checks it at runtime; refusing it broke `@alepha/ui` the moment
   * Lore registered its routers.
   */
  it("takes a computed string on a registered router", () => {
    const computed = ["home", "project"].join("") as string;
    const dynamic: LinkProps<string, Registered> = { href: computed };
    expect(dynamic.href).toBe("homeproject");
  });

  it("takes any string while nothing is registered", () => {
    const untyped: LinkProps<string> = {
      href: "whatever",
      params: { anything: "goes" },
    };
    expect(untyped.href).toBe("whatever");
  });
});
