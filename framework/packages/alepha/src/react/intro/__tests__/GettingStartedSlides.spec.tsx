import { Alepha } from "alepha";
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import { describe, it } from "vitest";

import { apiRealmTs } from "../../../cli/core/templates/apiRealmTs.ts";
import { ReactBrowserRouterProvider } from "../../router/providers/ReactBrowserRouterProvider.ts";
import { useAdminSlide } from "../components/GettingStartedAdminSlide.tsx";
import { useAuthSlide } from "../components/GettingStartedAuthSlide.tsx";

/**
 * The slides tell the reader of a new project which file to open. They must
 * name what the scaffold writes: `src/api/Realm.ts`, whose `adminEmails`
 * reads `ADMIN_EMAIL`.
 */
describe("GettingStarted slides", () => {
  const Slides = () => {
    const slides = [useAuthSlide(), useAdminSlide()];
    return createElement(
      Fragment,
      null,
      slides.flatMap((slide, s) =>
        (slide?.steps ?? []).map((step, i) =>
          createElement("p", { key: `${s}-${i}` }, step.text),
        ),
      ),
    );
  };

  const render = async (): Promise<string> => {
    const alepha = Alepha.create();
    const router = alepha.inject(ReactBrowserRouterProvider);
    router.add({ name: "home", path: "/", component: Slides });
    router.add({ name: "login", path: "/auth/login", component: () => "" });
    router.add({
      name: "register",
      path: "/auth/register",
      component: () => "",
    });
    router.add({ name: "admin", path: "/admin", component: () => "" });
    await alepha.start();
    await router.transition(new URL("http://localhost/"));
    const state = alepha.store.get("alepha.react.router.state");
    return renderToString(router.root(state!));
  };

  it("names the files and the variable the scaffold writes", async ({
    expect,
  }) => {
    const html = await render();

    expect(html).toContain("<code>src/api/Realm.ts</code>");
    expect(html).toContain("<code>ADMIN_EMAIL</code>");
    expect(html).not.toContain("AppSecurity");
    // What the slide says of `Realm.ts` is what the scaffold puts in it.
    expect(apiRealmTs({ appName: "myapp" })).toContain(
      "adminEmails: this.env.ADMIN_EMAIL",
    );
  });

  it("sends a sign-up to the registration page, under its own path", async ({
    expect,
  }) => {
    const html = await render();

    expect(html).toMatch(
      /<a href="\/auth\/register"[^>]*>\/auth\/register<\/a>/,
    );
    expect(html).toMatch(/<a href="\/admin"[^>]*>\/admin<\/a>/);
  });
});
