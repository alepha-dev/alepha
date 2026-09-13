import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AppShell, type AppShellProps, type NavGroup } from "../app-shell.tsx";

/**
 * `navAccordion` keeps one nav group open at a time, and it defaults to ON,
 * so every app using the shell inherits it. Two things are asserted here that
 * a screenshot cannot: that opening a group closes the one beside it EVEN
 * ACROSS `SidebarGroup`s (exclusivity is a property of the rail, not of a
 * heading), and that `false` still gives the older behaviour, where every
 * group keeps its own state.
 *
 * ⚠️ The icon assertions read lucide's own class (`lucide-plus` /
 * `lucide-minus`) rather than a `data-` hook of ours. That is the only
 * durable handle on which glyph rendered: both are inline SVG with no text
 * and no accessible name, so a spec asking for a role or a label would be
 * green with either one drawn.
 *
 * ⚠️ "Is the child in the DOM" is NOT the question, and asking it was how the
 * first draft of this file passed. A closed group stays MOUNTED so its height
 * can be animated, so the child text is always findable; what closes is the
 * wrapper, and `inert` is what takes the links out of the tab order in place
 * of the unmount that used to.
 */
describe("AppShell navAccordion", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * Two collapsible groups, deliberately in two different `SidebarGroup`s:
   * one rail with both would pass while exclusivity was only ever applied
   * per heading, which is the bug this spec exists to catch.
   */
  const NAV: NavGroup[] = [
    {
      label: "Workspace",
      items: [
        {
          label: "Projects",
          children: [
            { href: "/projects/active", label: "Active" },
            { href: "/projects/archived", label: "Archived" },
          ],
        },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          label: "Insights",
          children: [
            { href: "/insights/analytics", label: "Analytics" },
            { href: "/insights/vitals", label: "Vitals" },
          ],
        },
      ],
    },
  ];

  const mount = async (props: Partial<AppShellProps> = {}) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AppShell nav={NAV} {...props}>
          <div />
        </AppShell>
      </AlephaContext.Provider>,
    );
  };

  const row = (label: string) => screen.getByText(label).closest("button")!;

  /** The collapse wrapper belonging to a group row. */
  const panel = (label: string) =>
    row(label).closest("li")!.querySelector("[data-state]")!;

  const stateOf = (label: string) => ({
    state: panel(label).getAttribute("data-state"),
    inert: panel(label).hasAttribute("inert"),
  });

  const glyphOf = (label: string) => {
    const svg = row(label).querySelector("svg");
    const cls = svg?.getAttribute("class") ?? "";
    if (cls.includes("lucide-minus")) return "minus";
    if (cls.includes("lucide-plus")) return "plus";
    if (cls.includes("lucide-chevron-right")) return "caret";
    return cls;
  };

  const caretTurned = (label: string) =>
    (row(label).querySelector("svg")?.getAttribute("class") ?? "").includes(
      "rotate-90",
    );

  it("carries a caret by default, and turns it as the group opens", async () => {
    await mount();
    expect(glyphOf("Projects")).toBe("caret");
    expect(caretTurned("Projects")).toBe(false);

    fireEvent.click(row("Projects"));
    expect(glyphOf("Projects")).toBe("caret");
    expect(caretTurned("Projects")).toBe(true);
  });

  it("swaps the caret for a plus and a minus when asked", async () => {
    await mount({ navToggleIcon: "plusMinus" });
    expect(glyphOf("Projects")).toBe("plus");

    fireEvent.click(row("Projects"));
    expect(glyphOf("Projects")).toBe("minus");

    fireEvent.click(row("Projects"));
    expect(glyphOf("Projects")).toBe("plus");
  });

  it("closes the open group when another one opens", async () => {
    await mount();

    fireEvent.click(row("Projects"));
    expect(stateOf("Projects")).toEqual({ state: "open", inert: false });

    fireEvent.click(row("Insights"));
    expect(stateOf("Insights")).toEqual({ state: "open", inert: false });
    expect(stateOf("Projects")).toEqual({ state: "closed", inert: true });
    expect(caretTurned("Projects")).toBe(false);
  });

  it("lets every group stay open when it is off", async () => {
    await mount({ navAccordion: false });

    fireEvent.click(row("Projects"));
    fireEvent.click(row("Insights"));

    expect(stateOf("Projects")).toEqual({ state: "open", inert: false });
    expect(stateOf("Insights")).toEqual({ state: "open", inert: false });
  });

  it("drops the transition when navAnimate is off, and keeps the state", async () => {
    await mount({ navAnimate: false });

    expect(panel("Projects").className).not.toContain("transition-");

    fireEvent.click(row("Projects"));
    expect(stateOf("Projects")).toEqual({ state: "open", inert: false });
  });
});
