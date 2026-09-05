import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import { type ComponentType, lazy, Suspense, useMemo } from "react";

/**
 * What `/preview` renders inside the viewport iframe: one page's component,
 * with no shell around it.
 *
 * ## Why an iframe at all
 *
 * Narrowing a `<div>` to 375px simulates nothing. Every responsive decision in
 * `@alepha/ui` asks the WINDOW: Tailwind's `sm:` / `md:` are viewport media
 * queries, and `useIsMobile()` is `window.matchMedia("(max-width: 767px)")`.
 * At 375px of preview width inside a 1280px window they all still report the
 * desktop answer, so `AlephaTable` kept its filters inline instead of folding
 * them behind the button it has for exactly that case.
 *
 * An iframe is a real browsing context with its own viewport, so every one of
 * those queries answers correctly with the components unchanged.
 *
 * A React portal into an iframe document was the cheaper idea and is wrong
 * twice: the tree still runs in the PARENT's JS context, so `useIsMobile`
 * reads the parent window, and Base UI portals its popovers to the owner
 * document's body, which would put every select and dialog outside the frame.
 *
 * ## Why its own route
 *
 * The block pages are `static: true`, so Cloudflare serves their prerendered
 * HTML from the asset manifest. HTML built with no query string cannot also be
 * the bare rendering of `?bare=1`: hydration would find a shell the client
 * does not draw, log a mismatch and re-render from scratch. A separate,
 * non-static route has no prerendered copy to disagree with.
 */
export const PREVIEW_PATH = "/preview";

/**
 * Every page module, resolved by Vite at build time.
 *
 * A glob rather than a hand-written map: a registry with one line per page is
 * a list that goes stale the first time somebody adds a page and forgets it,
 * and the symptom would be one viewport button quietly showing an error.
 * `Showcase`'s `id` IS the module path under `pages/`, so the two cannot drift
 * without the file having been moved.
 */
const PAGES = import.meta.glob("./**/*.tsx") as Record<
  string,
  () => Promise<{ default: ComponentType }>
>;

const PreviewFrame = () => {
  const state = useRouterState();
  const id = state.url.searchParams.get("p") ?? "";

  const Page = useMemo(() => {
    const load = PAGES[`./${id}.tsx`];
    return load ? lazy(load) : undefined;
  }, [id]);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        {Page ? (
          <Suspense fallback={null}>
            <Page />
          </Suspense>
        ) : (
          <p className="text-destructive p-6 text-sm">
            No preview module for <code className="font-mono">{id}</code>.
          </p>
        )}
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default PreviewFrame;
