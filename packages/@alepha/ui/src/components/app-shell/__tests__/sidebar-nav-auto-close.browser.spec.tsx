import { SidebarProvider, useSidebar } from "@alepha/ui/components/ui/sidebar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SidebarNavAutoClose } from "../app-shell.tsx";

/**
 * Tapping a nav entry on a phone navigated and left the sheet up, so the
 * destination page rendered behind an overlay the reader had to dismiss by
 * hand (feedback #2077, at 491x929). Nothing closed it: `SidebarNavItem`
 * renders a `Link` and never touched `openMobile`.
 *
 * The fix is one capture handler around the whole sidebar rather than a
 * callback per nav item, because the links in that sheet come from five
 * different places - the nav leaves, the group children, the collapsed
 * dropdown, the brand slot's project switcher and each app's own sidebar
 * footer - and a per-item handler covers whichever of those someone
 * remembers today.
 *
 * ⚠️ These assert `openMobile`, not the DOM. Base UI keeps a dismissed sheet
 * mounted through its exit animation (`data-closed`, opacity 0), so "is the
 * element still there" is not the question and a spec asking it would be
 * green for the wrong reason.
 */
describe("SidebarNavAutoClose", () => {
  const setViewport = (mobile: boolean) => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) =>
        ({
          matches: mobile,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    });
  };

  /**
   * Reports the sheet's state into the DOM, and opens it on mount so the
   * spec starts from the state the reader is actually in when they tap.
   */
  const Probe = () => {
    const { openMobile, setOpenMobile } = useSidebar();
    return (
      <>
        <button
          type="button"
          data-testid="open"
          onClick={() => setOpenMobile(true)}
        >
          open
        </button>
        <span data-testid="state">{openMobile ? "open" : "closed"}</span>
      </>
    );
  };

  const mount = (children: React.ReactNode) =>
    render(
      <SidebarProvider>
        <Probe />
        <SidebarNavAutoClose>{children}</SidebarNavAutoClose>
      </SidebarProvider>,
    );

  const openSheet = () => {
    fireEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("state").textContent).toBe("open");
  };

  beforeEach(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(() => {
    cleanup();
  });

  it("closes the sheet when a nav link is activated", () => {
    setViewport(true);
    mount(
      <a href="/projects/lore/epics" data-testid="link">
        <span data-testid="label">Epics</span>
      </a>,
    );
    openSheet();

    fireEvent.click(screen.getByTestId("link"));

    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("closes when the click lands on something inside the link", () => {
    // What actually happens: the tap hits the label span or the icon, never
    // the anchor itself, so a handler reading `event.target` alone misses it.
    setViewport(true);
    mount(
      <a href="/projects/lore/epics" data-testid="link">
        <span data-testid="label">Epics</span>
      </a>,
    );
    openSheet();

    fireEvent.click(screen.getByTestId("label"));

    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("leaves the sheet alone for a button, a placeholder href and a new tab", () => {
    setViewport(true);
    mount(
      <>
        {/* The project switcher and the group disclosures are buttons that
            open something INSIDE the sheet. */}
        <button type="button" data-testid="switcher">
          Switch project
        </button>
        {/* A locked nav row: `SidebarNavItem` renders `item.href ?? "#"`.
            The placeholder href is the fixture, so the rule that objects to
            it is objecting to the case under test. */}
        {/* oxlint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a href="#" data-testid="locked">
          Locked
        </a>
        <a href="/docs" target="_blank" rel="noreferrer" data-testid="external">
          Docs
        </a>
      </>,
    );

    for (const id of ["switcher", "locked", "external"]) {
      openSheet();
      fireEvent.click(screen.getByTestId(id));
      expect(
        screen.getByTestId("state").textContent,
        `${id} closed the sheet`,
      ).toBe("open");
    }
  });

  it("does nothing on desktop, and does not even wrap", () => {
    setViewport(false);
    const { container } = mount(
      <a href="/projects/lore/epics" data-testid="link">
        Epics
      </a>,
    );

    // `openMobile` does not drive the desktop rail, so a stray write here
    // would be harmless - the point is that the component stands entirely
    // aside rather than adding a listener that runs on every nav click.
    expect(
      container.querySelector('[data-slot="sidebar-nav-auto-close"]'),
    ).toBeNull();

    openSheet();
    fireEvent.click(screen.getByTestId("link"));
    expect(screen.getByTestId("state").textContent).toBe("open");
  });
});
