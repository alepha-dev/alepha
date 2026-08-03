import { Alepha } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AuthRouter } from "../auth-router.tsx";

/**
 * Registering `AuthRouter` must be the whole integration.
 *
 * The four pages it mounts are what `@alepha/mantine/auth/AuthRouter` used to
 * provide before it was deleted with Mantine and not ported — which is why both
 * `apps/lore` and `apps/shop` ended up rebuilding the same screens by hand.
 *
 * The paths are asserted literally because they are a contract, not an
 * implementation detail: the auth components fall back to exactly these strings
 * (`props.loginPath ?? "/auth/login"`), so a path drifting here would silently
 * turn every cross-link in the package into a 404. That failure is invisible to
 * typecheck and to any test that reaches a page by URL.
 *
 * The names matter as much: `$secure`'s redirect and `ButtonUser`'s sign-in action
 * both push a route called `login`.
 */
describe("AuthRouter", () => {
  const mount = async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AuthRouter);
    await alepha.start();
    return alepha
      .primitives($page)
      .map((page) => ({ path: page.options.path, name: page.options.name }));
  };

  it("mounts the four authentication screens", async () => {
    const pages = await mount();

    expect(pages).toEqual(
      expect.arrayContaining([
        { path: "/auth/login", name: "login" },
        { path: "/auth/register", name: "register" },
        { path: "/auth/reset-password", name: "resetPassword" },
        { path: "/auth/verify-email", name: "verifyEmail" },
      ]),
    );
  });

  it("names sign-in `login`, which is what the rest of the framework pushes", async () => {
    const pages = await mount();

    expect(pages.find((page) => page.name === "login")?.path).toBe(
      "/auth/login",
    );
  });
});
