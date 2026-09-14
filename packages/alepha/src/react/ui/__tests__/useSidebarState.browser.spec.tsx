import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";

import { uiAtom } from "../atoms/uiAtom.ts";
import { useSidebarState } from "../hooks/useSidebarState.ts";

/**
 * The hydration pass of `useSidebarState` (#Q2347).
 *
 * A prerendered page holds the expanded shell and no ui state in its payload,
 * while the browser store already holds the visitor's collapsed cookie. The
 * hook used to render the store in the hydration pass, which is a mismatch:
 * on the real shell, React #418 on every load.
 *
 * ⚠️ Driven through a real `hydrateRoot` over server HTML, and the probe
 * renders the value as TEXT, so a mismatch is exactly the error React throws
 * for it rather than an attribute it would silently keep.
 */
describe("useSidebarState during hydration", () => {
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    document.body.innerHTML = "";
  });

  const Probe = () => {
    const { collapsed } = useSidebarState();
    return <span>{collapsed ? "collapsed" : "expanded"}</span>;
  };

  const collapsedUi = {
    ...uiAtom.options.default!,
    sidebar: { collapsed: true },
  };

  /**
   * Hydrate `serverText` with the store holding a collapsed sidebar, and the
   * SSR payload carrying `payload`.
   */
  const hydrate = async (serverText: string, payload: object) => {
    const script = document.createElement("script");
    script.id = "__ssr";
    script.type = "application/json";
    script.textContent = JSON.stringify(payload);
    document.body.append(script);

    const container = document.createElement("div");
    container.innerHTML = `<span>${serverText}</span>`;
    document.body.append(container);

    const alepha = Alepha.create();
    await alepha.start();
    alepha.store.set(uiAtom, collapsedUi);

    const errors: unknown[] = [];
    root = hydrateRoot(
      container,
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
      { onRecoverableError: (error) => errors.push(error) },
    );

    // The hydration pass, then the render the mount flag schedules.
    for (let i = 0; i < 50 && container.textContent !== "collapsed"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { container, errors };
  };

  it("hydrates a prerendered page with what it rendered, then adopts the cookie", async ({
    expect,
  }) => {
    const { container, errors } = await hydrate("expanded", {
      "alepha.react.router.layers": [],
    });

    expect(errors).toEqual([]);
    expect(container.textContent).toBe("collapsed");
  });

  it("hydrates a page rendered for the request with the value its payload carries", async ({
    expect,
  }) => {
    const { container, errors } = await hydrate("collapsed", {
      "alepha.react.router.layers": [],
      [uiAtom.key]: collapsedUi,
    });

    expect(errors).toEqual([]);
    expect(container.textContent).toBe("collapsed");
  });

  it("falls back to the default for a payload value that fails the schema", async ({
    expect,
  }) => {
    const { container, errors } = await hydrate("expanded", {
      [uiAtom.key]: { sidebar: "collapsed" },
    });

    expect(errors).toEqual([]);
    expect(container.textContent).toBe("collapsed");
  });
});
