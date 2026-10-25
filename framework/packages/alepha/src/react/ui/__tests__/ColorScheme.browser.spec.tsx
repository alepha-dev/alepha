import { act, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { uiAtom } from "../atoms/uiAtom.ts";
import { type UiTheme, uiThemeListAtom } from "../atoms/uiThemeListAtom.ts";
import { ColorScheme } from "../components/ColorScheme.tsx";

/**
 * The font `<link>` used to be injected by `<ButtonTheme/>`, which only
 * mounts on pages that render a theme picker. Every page without a toolbar
 * (Lore's `/auth/login`, for one) got the theme's colors and none of its
 * font, so `--font-display` fell back down its stack with nothing to say so.
 * `<ColorScheme/>` is mounted unconditionally, which is why it owns this now.
 */
describe("ColorScheme font link", () => {
  const THEMES: UiTheme[] = [
    { id: "default", label: "Default", fontHref: "/fonts/default.css" },
    { id: "arcane", label: "Arcane", fontHref: "/fonts/arcane.css" },
    { id: "plain", label: "Plain" },
  ];

  const link = () => document.getElementById("alepha-theme-fonts");

  const setup = async (theme: string, themes: UiTheme[] = THEMES) => {
    const alepha = Alepha.create();
    await alepha.start();
    alepha.store.set(uiThemeListAtom, themes);
    alepha.store.set(uiAtom, {
      ...uiAtom.options.default!,
      theme,
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const setTheme = async (next: string) => {
      await act(async () => {
        alepha.store.set(uiAtom, { ...uiAtom.options.default!, theme: next });
      });
    };

    return { alepha, wrapper, setTheme };
  };

  beforeEach(() => {
    link()?.remove();
    document.documentElement.className = "";
  });

  it("should inject the active theme's stylesheet without any picker mounted", async () => {
    const { wrapper } = await setup("arcane");

    render(<ColorScheme />, { wrapper });

    expect(link()?.getAttribute("href")).toBe("/fonts/arcane.css");
    expect(link()?.getAttribute("rel")).toBe("stylesheet");
  });

  it("should inject the default theme's stylesheet, which carries no theme- class", async () => {
    const { wrapper } = await setup("default");

    render(<ColorScheme />, { wrapper });

    expect(document.documentElement.className).not.toContain("theme-");
    expect(link()?.getAttribute("href")).toBe("/fonts/default.css");
  });

  it("should swap the stylesheet when the theme changes, keeping a single link", async () => {
    const { wrapper, setTheme } = await setup("default");

    render(<ColorScheme />, { wrapper });
    await setTheme("arcane");

    expect(link()?.getAttribute("href")).toBe("/fonts/arcane.css");
    expect(document.querySelectorAll("#alepha-theme-fonts").length).toBe(1);
  });

  it("should remove the stylesheet when the selected theme declares no font", async () => {
    const { wrapper, setTheme } = await setup("arcane");

    render(<ColorScheme />, { wrapper });
    expect(link()).not.toBe(null);

    await setTheme("plain");

    expect(link()).toBe(null);
  });

  it("should fall back to the first theme when the selected id is unknown", async () => {
    const { wrapper } = await setup("does-not-exist");

    render(<ColorScheme />, { wrapper });

    expect(link()?.getAttribute("href")).toBe("/fonts/default.css");
  });

  it("should inject nothing when no theme declares a font", async () => {
    const { wrapper } = await setup("plain", [{ id: "plain", label: "Plain" }]);

    render(<ColorScheme />, { wrapper });

    expect(link()).toBe(null);
  });
});
