import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ColorScheme } from "alepha/react/ui";
import { Search } from "lucide-react";
import { useState } from "react";

import { cn } from "../core/utils.ts";
import { ButtonSettings } from "../shell/ButtonSettings.tsx";
import { NavShell } from "../shell/NavShell.tsx";
import { Spotlight } from "../shell/Spotlight.tsx";
import { AccountBackToSiteMenuItem } from "./AccountBackToSiteMenuItem.tsx";
import { AccountBrand } from "./AccountBrand.tsx";
import { accountRouterOptionsAtom } from "./AccountRouterOptions.tsx";

/**
 * The account shell: the account counterpart of `AdminLayout`, a root,
 * full-viewport `NavShell` with a floating sidebar and its own topbar.
 *
 * The sidebar and breadcrumbs are derived from the route subtree anchored at
 * `account`: every page carries its own `nav`, so a page added with
 * `$pageAccount` appears without registering anywhere.
 *
 * It is a root shell, never adopted into the application's layout, and that
 * decides four things:
 *
 * - `<ColorScheme />` is mounted here, because nothing else above `/account`
 *   applies the dark-mode class to `<html>`. `colorScheme: false` opts out.
 * - `AppShell` (not `embedded`) mounts `DialogProvider`, `Toaster` and
 *   `ActionErrorToaster`, so the pages' `useDialog()` and toasts work with no
 *   provider from the application. An application that still adopted this
 *   layout under its own `Toaster` would show every toast twice, which is
 *   why adoption is no longer a way to mount it.
 * - `h-svh` on the wrapper plus `fill` on `NavShell` bounds `main`, so a
 *   table page scrolls its own body and a form page (`AccountPage
 *   variant="form"`) scrolls its column, while the sidebar and topbar stay.
 * - The topbar is `AdminLayout`'s arrangement: a ⌘K trigger for a Spotlight
 *   scoped to `account`, then `ButtonSettings`. The trigger renders outside
 *   the replaceable `topbarActions` cluster, since its open state lives here.
 *   The menu's way out is `AccountBackToSiteMenuItem`, not the admin item
 *   `AdminLayout` relabels: that one is gated on `admin:ui`, so most people
 *   in `/account` would never see it. The admin item stays "Admin Panel".
 */
export const AccountLayout = () => {
  const [options] = useStore(accountRouterOptionsAtom);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const { tr } = useI18n();

  return (
    <div className={cn("flex h-svh flex-col", options.className)}>
      {options.colorScheme !== false && <ColorScheme />}
      <NavShell
        root="account"
        variant="floating"
        fill
        extraNav={options.extraNav}
        brand={options.brand ?? <AccountBrand />}
        topbarActions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSpotlightOpen(true)}
              className="text-muted-foreground hover:bg-hover hover:text-foreground hidden h-8 items-center gap-2 rounded-md border px-2 text-sm transition-colors sm:flex"
            >
              <Search className="size-4 shrink-0" />
              <span>{tr("nav.spotlight.search", { default: "Search…" })}</span>
              <kbd className="bg-muted text-muted-foreground pointer-events-none ml-2 hidden rounded px-1.5 font-mono text-[10px] md:inline">
                ⌘K
              </kbd>
            </button>
            <div
              aria-hidden="true"
              className="bg-border mx-1 h-5 w-px shrink-0"
            />
            {options.topbarActions ?? (
              <ButtonSettings loginRouteName={options.loginRouteName}>
                <AccountBackToSiteMenuItem routeName={options.homeRouteName} />
              </ButtonSettings>
            )}
          </div>
        }
      />
      <Spotlight
        root="account"
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
      />
    </div>
  );
};

export default AccountLayout;
