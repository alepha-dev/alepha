import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { NavShell } from "@alepha/ui/components/nav-shell/nav-shell";
import { Spotlight } from "@alepha/ui/components/nav-shell/spotlight";
import { useRouter } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import { ArrowLeft, LayoutDashboard, Search } from "lucide-react";
import { useState } from "react";

/**
 * Lore admin shell. The sidebar nav and breadcrumb trail are derived from the
 * admin route subtree (anchored at the `admin` layout page) by `<NavShell>` —
 * each page carries its own `nav` metadata in AppAdminRouter, so there is no
 * hand-synced nav list here. This layout only supplies the chrome: brand,
 * language / dark-mode toggles and the account menu.
 */
export function AppAdminLayout() {
  const router = useRouter<any>();
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  return (
    // `h-svh` bounds the shell at the viewport. Combined with `fill` on
    // NavShell/AppShell (switches SidebarProvider from `min-h-svh` to
    // `h-full`), this lets the table body scroll inside the main area instead
    // of pushing the whole page taller.
    <div className="flex h-svh flex-col">
      {/* `/admin` is not a child of the global Layout, so we mount ColorScheme
        here ourselves — otherwise the dark/light toggle changes the atom but no
        React subscriber applies the class to <html> until a full reload. */}
      <ColorScheme />
      <NavShell
        root="admin"
        fill
        brand={
          <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
            <button
              type="button"
              onClick={() => router.push("home")}
              aria-label="Back to home"
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
            >
              <ArrowLeft className="size-4" />
            </button>
            <LayoutDashboard className="size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
            <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              Admin Panel
            </span>
          </div>
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
            <ButtonLanguage />
            <ButtonDark />
            <ButtonUser
              onSignIn={() => router.push("login")}
              onAdminClick={() => router.push("home")}
            />
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
}
