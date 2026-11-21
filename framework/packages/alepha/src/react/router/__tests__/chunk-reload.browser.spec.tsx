import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import { $page, ReactRouter } from "../index.browser.ts";

describe("Chunk load failure after a deployment", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
    sessionStorage.clear();
  });

  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const stale = async () => {
    throw new Error("Failed to fetch dynamically imported module");
  };

  const start = async () => {
    class App {
      home = $page({ path: "/", component: () => <main>home page</main> });

      // Two lazy layers in one navigation, both gone after the deployment.
      section = $page({ path: "/section", lazy: stale });
      page = $page({ parent: this.section, path: "/page", lazy: stale });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    return alepha.inject(ReactRouter);
  };

  it("keeps the current page on screen while the reload is on its way", async ({
    expect,
  }) => {
    const router = await start();
    expect(document.body.textContent).toContain("home page");

    // The navigation never settles: the browser is leaving for a fresh
    // document, so it is not awaited.
    await act(async () => {
      void router.push("/section/page");
      await wait(100);
    });

    expect(sessionStorage.getItem("alepha:chunk-reload")).not.toBeNull();
    expect(document.body.textContent).toContain("home page");
    expect(document.body.textContent).not.toContain("Something went wrong");
  });

  it("still gives up on a failure right after a reload, to avoid a loop", async ({
    expect,
  }) => {
    sessionStorage.setItem("alepha:chunk-reload", String(Date.now()));
    const router = await start();

    await act(async () => {
      await router.push("/section/page");
    });

    expect(document.body.textContent).not.toContain("home page");
  });
});
