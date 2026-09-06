import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useAlepha } from "alepha/react";
import { NestedView, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";

import { NavPalette } from "./components/NavPalette.tsx";
import { NavPaletteButton } from "./components/NavPaletteButton.tsx";
import { findCrumbs, NAV } from "./nav.ts";

const isActive = (href: string, pathname: string) => href === pathname;

/**
 * The shell around every page. Fixed, and no longer a specimen.
 *
 * Its variant used to come from a `persist: "localStorage"` atom that
 * `/blocks/shell` wrote, which was the only way to show `AppShell` before its
 * `fill` prop made a contained copy possible. The cost was that trying a
 * variant reshaped the whole site, on every later visit, from a page the
 * reader had already left. `/blocks/shell` renders its own shell now, so the
 * atom had no writer left and is gone, along with the hydration guard that
 * existed only to keep its stored value out of the first client render.
 *
 * ⚠️ The `h-svh overflow-hidden` wrapper and `fill` are one mechanism, and
 * every page depends on it. Without `fill`, `AppShell` renders its `<main>` as
 * `flex-1 overflow-auto`: nothing bounds the height, so the DOCUMENT becomes
 * the only scroller and a `Showcase`'s own `overflow-auto` never activates.
 * The header bar and the props panel then scroll away with the preview, which
 * is the one thing they must not do. With `fill`, `main` is
 * `min-h-0 flex-1 overflow-hidden` and the scrolling is the preview's own.
 */
export const Layout = () => {
  const alepha = useAlepha();
  const state = useRouterState();

  const pathname = state.url.pathname;
  const crumbs = findCrumbs(pathname);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        {/*
          Mounted here, above the router's outlet, so ⌘K and the palette exist
          on every page rather than only on the one that happens to show a
          search field.
        */}
        <NavPalette />
        <div className="flex h-svh flex-col overflow-hidden">
          <AppShell
            fill
            variant="floating"
            topbarActions={
              <>
                <NavPaletteButton />
                <ButtonTheme />
                <ButtonDark />
              </>
            }
            brand={
              /*
                The accessible name is on the ANCHOR, not on the image: both
                text lines are `display: none` in icon mode, so an `alt`
                carrying the name would be the only label in one state and a
                duplicate of the visible text in the other.
              */
              <a
                href="/"
                aria-label="Alepha UI"
                className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
              >
                {/*
                  `public/logo.svg` carries a `viewBox`, unlike the copy in
                  `packages/alepha/assets` it was taken from: without one the
                  artwork is drawn at 1 user unit per pixel and a 32px box
                  shows its top-left corner instead of the mark.
                  `object-contain` is what keeps the 300x241 drawing centred in
                  a square box.
                */}
                <img
                  src="/logo.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 shrink-0 object-contain"
                />
                <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm leading-tight font-semibold">
                    Alepha UI
                  </span>
                  {/*
                    The FRAMEWORK's version, which is what `meta.version` is
                    set to in `alepha.config.ts` - the showcase carries none of
                    its own. `latest` outside a build (vitest, a `tsx` script),
                    so it never renders empty.
                  */}
                  <span className="text-muted-foreground truncate text-xs leading-tight">
                    v{alepha.meta.version}
                  </span>
                </span>
              </a>
            }
            nav={NAV.map((group) => ({
              label: group.label,
              items: group.items.map((entry) =>
                entry.children
                  ? {
                      label: entry.label,
                      icon: entry.icon,
                      defaultOpen: entry.children.some((c) =>
                        isActive(c.href, pathname),
                      ),
                      children: entry.children.map((c) => ({
                        href: c.href,
                        label: c.label,
                        active: isActive(c.href, pathname),
                      })),
                    }
                  : {
                      href: entry.href,
                      label: entry.label,
                      icon: entry.icon,
                      active: isActive(entry.href ?? "", pathname),
                    },
              ),
            }))}
            breadcrumbs={crumbs.length ? crumbs : undefined}
          >
            <div className="flex h-full min-h-0 flex-col">
              <NestedView />
            </div>
          </AppShell>
        </div>
      </DialogProvider>
    </TooltipProvider>
  );
};
