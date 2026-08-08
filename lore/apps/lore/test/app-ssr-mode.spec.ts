import { Alepha } from "alepha";
import { AlephaReactRouter, ReactPageProvider } from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";
import { AppAdminRouter } from "../src/web/admin/AppAdminRouter.tsx";
import { AppRouter } from "../src/web/app/AppRouter.ts";

/**
 * Which pages server-render, pinned by name.
 *
 * Lore no longer sets `ssr` anywhere. The mode is derived from whether a page
 * sits behind a guard: `$secure` puts a page (and its subtree) in CSR, because
 * every visitor there is authenticated and no crawler gets past the redirect,
 * so the render would cost Worker CPU for nobody. Everything else keeps real
 * HTML.
 *
 * That makes the rendering mode a *consequence* of the access model rather than
 * a flag someone remembers to set — which is the point, and also the risk: add
 * `$secure` to a public page and you silently stop shipping HTML to crawlers;
 * forget it on a private one and you silently start server-rendering a back
 * office. This spec is what makes either mistake a red test.
 *
 * A name here that is not in the route table throws, so it doubles as the
 * rename guard `app-routes.spec.ts` provides for navigation names.
 */

/** Reachable without an account — must ship HTML. */
const PUBLIC_ROUTES = [
  "home",
  "login",
  "register",
  "resetPassword",
  "oauthContinue",
  // Third-party "report a bug" buttons link straight here, and an anonymous
  // visitor gets a sign-in CTA rather than a redirect.
  "projectFeedbackRequest",
  "notFound",
];

/** Behind the login wall — must not be server-rendered. */
const GUARDED_ROUTES = [
  "projectCreate",
  // The project layout and a representative spread of its subtree, which
  // inherits the decision rather than repeating the guard.
  "project",
  "projectQuests",
  "projectQuest",
  "projectFolios",
  "projectSettingsMembers",
  "projectBlights",
  "appAnalytics",
  "reportsOverview",
  // Own-account area (MeRouter) and the admin shell, which already carried
  // `$secure({ permissions: ["admin:ui"] })` before this change and was being
  // server-rendered for nobody's benefit.
  "me",
  "admin",
];

describe("AppRouter rendering mode", () => {
  let alepha: Alepha;
  let pages: ReactPageProvider;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } });
    alepha.with(AlephaReactRouter);
    alepha.inject(AppRouter);
    // Its own module in the real app (main.server.ts / main.browser.ts), so it
    // has to be wired explicitly here — and it is the most interesting case:
    // it already carried `$secure` before this change and was server-rendered.
    alepha.inject(AppAdminRouter);
    pages = alepha.inject(ReactPageProvider);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const isSSR = (name: string): boolean => {
    const route = pages.getPages().find((it) => it.name === name);
    if (!route) {
      throw new Error(
        `route '${name}' not found — renamed or deleted without updating this spec`,
      );
    }
    return pages.isSSR(route);
  };

  for (const name of PUBLIC_ROUTES) {
    it(`server-renders '${name}'`, ({ expect }) => {
      expect(isSSR(name)).toBe(true);
    });
  }

  for (const name of GUARDED_ROUTES) {
    it(`skips the render for '${name}'`, ({ expect }) => {
      expect(isSSR(name)).toBe(false);
    });
  }

  it("keeps the shared layout renderable for its anonymous children", ({
    expect,
  }) => {
    // The shell is shared by public and guarded pages alike, so it must not
    // carry a guard of its own — that would drag login and the landing page
    // into CSR with it.
    expect(isSSR("layout")).toBe(true);
  });

  it("declares no manual ssr flag anywhere", ({ expect }) => {
    // The whole point of the migration: the mode is derived, never set. A flag
    // reappearing means someone worked around the derivation instead of fixing
    // the access model it reads.
    const withExplicitSsr = pages
      .getPages()
      .filter((route) => typeof route.ssr === "boolean")
      .map((route) => route.name);

    expect(withExplicitSsr).toEqual([]);
  });
});
