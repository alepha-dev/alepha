import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { $page, ReactRouter } from "../index.browser.ts";

describe("NestedView exit animation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("should not commit a view that a later navigation has superseded", async () => {
    // The `react:transition:end` handler sleeps out the leaving page's exit
    // animation and then commits the view captured when it started. A second
    // navigation landing during that sleep commits first — and then the older
    // handler woke up and overwrote it with the page the user had already
    // navigated away from.
    class App {
      a = $page({
        path: "/a",
        animation: { exit: { name: "fade-out", duration: 120 } },
        component: () => <div data-testid="view">A</div>,
      });

      b = $page({
        path: "/b",
        component: () => <div data-testid="view">B</div>,
      });

      c = $page({
        path: "/c",
        component: () => <div data-testid="view">C</div>,
      });
    }

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/a");
    });
    expect(document.querySelector('[data-testid="view"]')?.textContent).toBe(
      "A",
    );

    await act(async () => {
      // Not awaited: leaving /a starts a 120ms exit animation, so this
      // transition's commit is still pending when the next one lands — which
      // is exactly what a user double-clicking two links produces.
      const leavingA = router.push("/b");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await router.push("/c");
      await leavingA;
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(document.querySelector('[data-testid="view"]')?.textContent).toBe(
      "C",
    );
  });
});
