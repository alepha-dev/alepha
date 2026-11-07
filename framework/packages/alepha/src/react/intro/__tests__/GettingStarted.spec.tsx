import { Alepha } from "alepha";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, it } from "vitest";

import { ReactBrowserRouterProvider } from "../../router/providers/ReactBrowserRouterProvider.ts";
import GettingStarted, {
  formatServerTime,
} from "../components/GettingStarted.tsx";

/**
 * The starter home page hydrates in the visitor's browser what the server
 * rendered (#Q3149). Anything on it that reads the environment's time zone or
 * locale renders one string on a UTC server and another in the browser, and
 * React throws error #418 on every first visit of a new app.
 *
 * A browser spec cannot see this: server and browser would share one zone.
 * Rendering the page twice in one process under two zones can, since Node
 * applies a change to `process.env.TZ` at once.
 */
describe("GettingStarted", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  const render = async (tz: string): Promise<string> => {
    process.env.TZ = tz;
    const alepha = Alepha.create();
    const router = alepha.inject(ReactBrowserRouterProvider);
    router.add({
      name: "home",
      path: "/",
      component: () =>
        createElement(GettingStarted, {
          welcome: {
            appName: "Myapp",
            serverTime: "2026-11-06T16:51:00.000Z",
          },
        }),
    });
    await alepha.start();
    await router.transition(new URL("http://localhost/"));
    const state = alepha.store.get("alepha.react.router.state");
    if (!state) {
      throw new Error("Router state not found.");
    }
    return renderToString(router.root(state));
  };

  it("renders the same HTML whatever the time zone", async ({ expect }) => {
    const utc = await render("UTC");
    const kiritimati = await render("Pacific/Kiritimati");
    const honolulu = await render("Pacific/Honolulu");

    expect(kiritimati).toBe(utc);
    expect(honolulu).toBe(utc);
    expect(utc).toContain("Server time: 16:51:00 UTC");
  });

  it("formats the server time without the environment's zone or locale", ({
    expect,
  }) => {
    process.env.TZ = "Asia/Tokyo";
    expect(formatServerTime("2026-11-06T16:51:00.000Z")).toBe("16:51:00 UTC");
    expect(formatServerTime("2026-11-06T17:51:00+01:00")).toBe("16:51:00 UTC");
    expect(formatServerTime("not a date")).toBe("not a date");
  });
});
