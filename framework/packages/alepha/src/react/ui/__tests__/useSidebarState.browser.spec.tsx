import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, it } from "vitest";

import { uiAtom } from "../atoms/uiAtom.ts";
import { useSidebarState } from "../hooks/useSidebarState.ts";

/**
 * `useSidebarState` never lets the visitor's preference into a server render
 * (#E78): the shell's markup is the same for everyone, so the page cache can
 * share it and a prerendered page hydrates without a mismatch (#Q2347). The
 * preference arrives after hydration; the boot script's `data-sidebar` on
 * `<html>` paints it before that.
 *
 * ⚠️ Driven through a real `hydrateRoot` over server HTML, and the probe
 * renders the value as TEXT, so a mismatch is exactly the error React throws
 * for it rather than an attribute it would silently keep.
 */
describe("useSidebarState", () => {
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-sidebar");
  });

  const Probe = () => {
    const state = useSidebarState();
    return (
      <button type="button" onClick={state.toggle}>
        {state.collapsed ? "collapsed" : "expanded"}
      </button>
    );
  };

  const collapsedUi = {
    ...uiAtom.options.default!,
    sidebar: { collapsed: true },
  };

  const withCollapsedStore = async () => {
    const alepha = Alepha.create();
    await alepha.start();
    alepha.store.set(uiAtom, collapsedUi);
    return alepha;
  };

  it("renders the default on the server, whatever the store holds", async ({
    expect,
  }) => {
    const alepha = await withCollapsedStore();

    const html = renderToString(
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
    );

    expect(html).toContain("expanded");
  });

  it("hydrates the shared markup without a mismatch, then adopts the cookie", async ({
    expect,
  }) => {
    const container = document.createElement("div");
    container.innerHTML = '<button type="button">expanded</button>';
    document.body.append(container);
    const alepha = await withCollapsedStore();

    const errors: unknown[] = [];
    root = hydrateRoot(
      container,
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
      { onRecoverableError: (error) => errors.push(error) },
    );
    for (let i = 0; i < 50 && container.textContent !== "collapsed"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(errors).toEqual([]);
    expect(container.textContent).toBe("collapsed");
  });

  it("keeps <html data-sidebar> in step with the preference", async ({
    expect,
  }) => {
    const container = document.createElement("div");
    container.innerHTML = '<button type="button">expanded</button>';
    document.body.append(container);
    const alepha = await withCollapsedStore();
    root = hydrateRoot(
      container,
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
    );
    for (let i = 0; i < 50 && container.textContent !== "collapsed"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await act(async () => container.querySelector("button")!.click());

    expect(container.textContent).toBe("expanded");
    expect(document.documentElement.getAttribute("data-sidebar")).toBe(
      "expanded",
    );
    expect(alepha.store.get(uiAtom).sidebar.collapsed).toBe(false);
  });
});
