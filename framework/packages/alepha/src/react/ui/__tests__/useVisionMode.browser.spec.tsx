import { act, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import type { Head } from "alepha/react/head";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uiAtom } from "../atoms/uiAtom.ts";
import { ColorScheme } from "../components/ColorScheme.tsx";
import { useVisionMode } from "../hooks/useVisionMode.ts";
import { AlephaReactUi, UiPersistence } from "../index.ts";

/**
 * The vision mode (colour-blind palette) is a third UI preference beside the
 * color mode and the theme: `vision` in the `alepha-ui` cookie, the class
 * `cvd` and `data-vision` on `<html>`, painted by the boot script before
 * first paint and kept in step by `ColorScheme`.
 */
describe("useVisionMode", () => {
  const clearCookies = () => {
    for (const part of document.cookie.split(";")) {
      const name = part.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  };

  const resetRoot = () => {
    const root = document.documentElement;
    root.className = "";
    for (const name of ["data-vision", "data-color-mode", "data-sidebar"]) {
      root.removeAttribute(name);
    }
  };

  beforeEach(() => {
    clearCookies();
    resetRoot();
  });

  afterEach(() => {
    clearCookies();
    resetRoot();
  });

  const setup = async () => {
    const alepha = Alepha.create().with(AlephaReactUi);
    await alepha.start();
    const wrapper = (props: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>
        {props.children}
      </AlephaContext.Provider>
    );
    return { alepha, wrapper };
  };

  const Probe = () => {
    const vision = useVisionMode();
    return (
      <>
        <ColorScheme />
        <span data-testid="vision">{vision.vision}</span>
        <button type="button" onClick={vision.toggle}>
          toggle
        </button>
        <button type="button" onClick={() => vision.setVision("cvd")}>
          cvd
        </button>
      </>
    );
  };

  it("defaults to normal", async () => {
    expect(uiAtom.options.default!.vision).toBe("normal");
    const { alepha } = await setup();

    expect(alepha.store.get(uiAtom).vision).toBe("normal");
  });

  it("reads a state written before the field existed as normal", async () => {
    const { alepha } = await setup();
    const { vision: _vision, ...legacy } = uiAtom.options.default!;

    alepha.store.set(uiAtom, {
      ...legacy,
      theme: "forest",
    } as typeof uiAtom.options.default);

    expect(alepha.store.get(uiAtom)).toMatchObject({
      theme: "forest",
      vision: "normal",
    });
  });

  it("keeps the other preferences of a cookie written before the field existed", async () => {
    document.cookie = `alepha-ui=${encodeURIComponent(
      JSON.stringify({
        mode: "dark",
        theme: "forest",
        sidebar: { collapsed: true },
      }),
    )}; Path=/`;

    const { alepha } = await setup();

    expect(alepha.store.get(uiAtom)).toEqual({
      mode: "dark",
      theme: "forest",
      vision: "normal",
      sidebar: { collapsed: true },
    });
  });

  it("round-trips through the alepha-ui cookie", async () => {
    const { alepha, wrapper } = await setup();
    const view = render(<Probe />, { wrapper });

    await act(async () =>
      view.getByText("cvd", { selector: "button" }).click(),
    );

    expect(decodeURIComponent(document.cookie)).toContain('"vision":"cvd"');

    resetRoot();
    const next = await setup();
    expect(next.alepha.store.get(uiAtom).vision).toBe("cvd");
    expect(alepha.store.get(uiAtom).vision).toBe("cvd");
  });

  it("toggles the cvd class and data-vision on <html> through ColorScheme", async () => {
    const { wrapper } = await setup();
    const view = render(<Probe />, { wrapper });
    const root = document.documentElement;

    expect(root.classList.contains("cvd")).toBe(false);
    expect(root.getAttribute("data-vision")).toBe("normal");

    await act(async () => view.getByText("toggle").click());

    expect(view.getByTestId("vision").textContent).toBe("cvd");
    expect(root.classList.contains("cvd")).toBe(true);
    expect(root.getAttribute("data-vision")).toBe("cvd");

    await act(async () => view.getByText("toggle").click());

    expect(view.getByTestId("vision").textContent).toBe("normal");
    expect(root.classList.contains("cvd")).toBe(false);
    expect(root.getAttribute("data-vision")).toBe("normal");
  });

  it("combines with dark mode and a theme", async () => {
    const { alepha, wrapper } = await setup();
    render(<Probe />, { wrapper });

    await act(async () => {
      alepha.store.set(uiAtom, {
        ...uiAtom.options.default!,
        mode: "dark",
        theme: "forest",
        vision: "cvd",
      });
    });

    const classes = document.documentElement.classList;
    expect(classes.contains("dark")).toBe(true);
    expect(classes.contains("theme-forest")).toBe(true);
    expect(classes.contains("cvd")).toBe(true);
  });

  describe("boot script", () => {
    const boot = async () => {
      const alepha = Alepha.create().with(AlephaReactUi);
      const persistence = alepha.inject(UiPersistence);
      const options = persistence.head.options;
      const head = (
        typeof options === "function" ? options() : options
      ) as Head;
      const script = head.script?.[0];
      const content = typeof script === "string" ? script : script?.content;
      // oxlint-disable-next-line typescript/no-implied-eval -- runs the inline boot script as the browser would
      new Function(content ?? "")();
    };

    const withCookie = (value: object) => {
      document.cookie = `alepha-ui=${encodeURIComponent(
        JSON.stringify(value),
      )}; Path=/`;
    };

    it("adds the cvd class and data-vision before paint", async () => {
      withCookie({
        mode: "dark",
        theme: "forest",
        vision: "cvd",
        sidebar: { collapsed: false },
      });

      await boot();

      const root = document.documentElement;
      expect(root.classList.contains("cvd")).toBe(true);
      expect(root.classList.contains("dark")).toBe(true);
      expect(root.classList.contains("theme-forest")).toBe(true);
      expect(root.getAttribute("data-vision")).toBe("cvd");
    });

    it("marks a cookie without the field as normal", async () => {
      withCookie({ mode: "light", theme: "default" });

      await boot();

      const root = document.documentElement;
      expect(root.classList.contains("cvd")).toBe(false);
      expect(root.getAttribute("data-vision")).toBe("normal");
    });

    it("marks a visitor with no cookie as normal", async () => {
      await boot();

      expect(document.documentElement.getAttribute("data-vision")).toBe(
        "normal",
      );
    });
  });
});
