import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { NavShell } from "@alepha/ui/components/nav-shell/nav-shell";
import { Spotlight } from "@alepha/ui/components/nav-shell/spotlight";
import { DropdownMenuSeparator } from "@alepha/ui/components/ui/dropdown-menu";
import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import { LayoutDashboard, Search } from "lucide-react";
import { useState } from "react";
import { adminRouterOptionsAtom } from "./admin-router-options.tsx";

/**
 * The admin shell.
 *
 * The sidebar and breadcrumb trail are derived from the route subtree
 * anchored at `admin` — every page carries its own `nav` metadata, so there
 * is no hand-synced list here and an application page that adopts the layout
 * appears in the sidebar without registering anywhere.
 *
 * Four details are load-bearing rather than decorative:
 *
 * - `<ColorScheme />` is mounted here because `/admin` is not a child of the
 *   application's own layout. Without it the dark-mode toggle updates the
 *   atom and no subscriber applies the class to `<html>` until a full reload.
 *   `colorScheme: false` opts out, for applications whose host document owns
 *   the `<html>` theme class itself — see `AdminRouterOptions.colorScheme`.
 * - `h-svh` on the wrapper plus `fill` on `NavShell` switches
 *   `SidebarProvider` from `min-h-svh` to `h-full`, which is what lets a table
 *   body scroll inside the main area instead of pushing the whole page taller.
 * - Spotlight is `root`-scoped to `admin`, so ⌘K searches admin pages only.
 *   Its trigger button renders outside the `topbarActions` slot: the open
 *   state is local to this component, so a replacement cluster could never
 *   rebuild the button — replacing the cluster must not cost the affordance.
 * - `ButtonUser` is given custom `children` rather than its default
 *   `onAdminClick` menu: that default item is labelled "Admin Panel" and
 *   documented as `router.push("admin")` — the exact opposite of what it
 *   would do here, since the account menu already lives inside `/admin` and
 *   the only useful action is leaving it. Composing the menu by hand keeps
 *   `ButtonUser`'s own default label correct for its normal use outside
 *   admin.
 */
export const AdminLayout = () => {
  const router = useRouter<any>();
  const [options] = useStore(adminRouterOptionsAtom);
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  return (
    <div className={cn("flex h-svh flex-col", options.className)}>
      {options.colorScheme !== false && <ColorScheme />}
      <NavShell
        root="admin"
        fill
        extraNav={options.extraNav}
        brand={
          options.brand ?? (
            <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
              <LayoutDashboard className="size-4 shrink-0" />
              <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                Admin
              </span>
            </div>
          )
        }
        topbarActions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSpotlightOpen(true)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground hidden h-8 items-center gap-2 rounded-md border px-2 text-sm transition-colors sm:flex"
            >
              <Search className="size-4 shrink-0" />
              <span>Search…</span>
              <kbd className="bg-muted text-muted-foreground pointer-events-none ml-2 hidden rounded px-1.5 font-mono text-[10px] md:inline">
                ⌘K
              </kbd>
            </button>
            <div
              aria-hidden="true"
              className="bg-border mx-1 h-5 w-px shrink-0"
            />
            {options.topbarActions ?? (
              <>
                <ButtonLanguage />
                <ButtonDark />
                <ButtonUser
                  onSignIn={() =>
                    router.push(options.loginRouteName ?? "login")
                  }
                >
                  <ButtonUser.Email />
                  <ButtonUser.AdminMenuItem
                    label="Back to site"
                    onClick={() => router.push(options.homeRouteName ?? "home")}
                  />
                  <DropdownMenuSeparator />
                  <ButtonUser.LogoutMenuItem />
                </ButtonUser>
              </>
            )}
          </div>
        }
      />
      <Spotlight
        root="admin"
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
      />
    </div>
  );
};

export default AdminLayout;
