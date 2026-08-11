import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { NavShell } from "@alepha/ui/components/nav-shell/nav-shell";
import { Spotlight } from "@alepha/ui/components/nav-shell/spotlight";
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
 * Three details are load-bearing rather than decorative:
 *
 * - `<ColorScheme />` is mounted here because `/admin` is not a child of the
 *   application's own layout. Without it the dark-mode toggle updates the
 *   atom and no subscriber applies the class to `<html>` until a full reload.
 * - `h-svh` on the wrapper plus `fill` on `NavShell` switches
 *   `SidebarProvider` from `min-h-svh` to `h-full`, which is what lets a table
 *   body scroll inside the main area instead of pushing the whole page taller.
 * - Spotlight is `root`-scoped to `admin`, so ⌘K searches admin pages only.
 */
export const AdminLayout = () => {
  const router = useRouter<any>();
  const [options] = useStore(adminRouterOptionsAtom);
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  return (
    <div className="flex h-svh flex-col">
      <ColorScheme />
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
          options.topbarActions ?? (
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
              <ButtonLanguage />
              <ButtonDark />
              <ButtonUser
                onSignIn={() => router.push("login")}
                onAdminClick={() =>
                  router.push(options.homeRouteName ?? "home")
                }
              />
            </div>
          )
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
