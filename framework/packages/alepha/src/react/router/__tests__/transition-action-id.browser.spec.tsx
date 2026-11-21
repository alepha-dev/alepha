import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import { $page, ReactRouter } from "../index.browser.ts";

/**
 * A route transition names itself in the `react:action:*` events (#Q4113):
 * a debugging trail reads which page was opened, not a bare "transition".
 */
describe("transition action events", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("carry the page name as id on begin, success and end", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => <div>Home</div> });
      settings = $page({ path: "/settings", component: () => <div>S</div> });
    }
    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });

    const seen: string[] = [];
    for (const phase of ["begin", "success", "end"] as const) {
      alepha.events.on(`react:action:${phase}`, (ev) => {
        if (ev.type === "transition") seen.push(`${phase}:${ev.id}`);
      });
    }

    await act(async () => {
      await alepha.inject(ReactRouter).push("/settings");
    });

    expect(seen).toEqual([
      "begin:settings",
      "success:settings",
      "end:settings",
    ]);
  });
});
