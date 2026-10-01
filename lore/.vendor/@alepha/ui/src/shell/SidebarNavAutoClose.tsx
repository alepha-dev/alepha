import * as React from "react";

void React;

import type { ReactNode } from "react";

import { useSidebar } from "../core/Sidebar.tsx";

export interface SidebarNavAutoCloseProps {
  children: ReactNode;
}

/**
 * Closes the mobile nav sheet when a link inside it is followed.
 *
 * On a phone the sidebar is a `Sheet` driven by `openMobile`. Tapping a nav
 * entry navigated and left the sheet up, so the destination page rendered
 * behind an overlay the reader had to dismiss by hand (feedback #2077, at
 * 491x929).
 *
 * ⚠️ One handler on the container, not a callback on each nav item. The links
 * inside that sheet are `AppShellSidebarNavItem`'s leaf,
 * `AppShellNavDropdownItems`, the group children, the brand slot's project
 * switcher and every app's own sidebar footer - a per-item `onClick` covers
 * whichever of those someone remembers today and silently misses the next one
 * added. A capture listener on the container covers them all, including the
 * ones no `@alepha/ui` file knows about, because it asks what the DOM event
 * actually landed on.
 *
 * It reacts to ANCHORS only. The switcher, the disclosure toggles and the
 * dropdown triggers in there are buttons that open something inside the sheet,
 * and closing it under them would break the control rather than fix it.
 */
export const SidebarNavAutoClose = (props: SidebarNavAutoCloseProps) => {
  const { isMobile, setOpenMobile } = useSidebar();

  // The desktop sidebar is not a sheet and `openMobile` does not drive it, so
  // this branch is not just an optimisation: running the handler there would
  // be a state write on every nav click for no reason. Collapsing the desktop
  // rail on navigation would be a new bug, not this fix.
  if (!isMobile) return props.children;

  return (
    // Capture, so the sheet closes even when the link's own handler stops
    // propagation on the way back up.
    <div
      data-slot="sidebar-nav-auto-close"
      className="flex h-full w-full flex-col"
      onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        if (!(anchor instanceof HTMLAnchorElement)) return;

        // Nothing here navigates the page the sheet is covering, so the sheet
        // has no reason to move: a placeholder `#` (the locked nav rows use
        // `item.href ?? "#"`), a download, a new tab, or a modified click that
        // the browser opens elsewhere.
        const href = anchor.getAttribute("href");
        if (!href || href === "#" || href.startsWith("#")) return;
        if (anchor.hasAttribute("download")) return;
        if (anchor.target && anchor.target !== "_self") return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        setOpenMobile(false);
      }}
    >
      {props.children}
    </div>
  );
};
