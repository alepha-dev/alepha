import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import {
  capabilityOption,
  currentProjectAtom,
  type I18n,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { ClientOnly, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import { ExternalLink } from "lucide-react";
import { useEffect } from "react";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { appLiveness } from "./appLiveness.ts";
import AppStatusDot from "./AppStatusDot.tsx";
import { appTabsFor } from "./appTabs.ts";
import { appUrl, appUrlLabel } from "./appUrl.ts";
import { APP_INSIGHTS_FILTER_KEYS } from "./useAppInsights.ts";

/**
 * The routes the tab bar is responsible for.
 *
 * The redirect below fires only for one of these: `appAnalyticsDimension` is a
 * SIBLING of `appAnalytics` rather than a tab, so it is legitimately missing
 * from the tab set and redirecting it would break every "More" link.
 */
const APP_TAB_ROUTES = new Set([
  "app",
  "appAnalytics",
  "appVitals",
  "appErrors",
  "appExplore",
  "appSettings",
]);

/**
 * One deployed copy: a plate naming it and a tab bar over what it has
 * unlocked.
 *
 * ## Tabs are unlocks, not configuration
 *
 * The set comes from `appTabsFor`, a predicate per tab over the instance
 * resource, so an instance with nothing shows Overview and
 * Settings, and each capability adds its own. The order and the "Settings is
 * always last" rule live there; read that file before adding one.
 *
 * ⚠️ The Apps options go in as a BAG, not as one `tracking` boolean, because
 * each gated tab names the option it answers to. Adding an option to
 * `shipCapabilityOptionsSchema` means adding it here too: a key this call
 * omits reads as off, which is the safe direction and a silent one.
 *
 * ## Deliberately thin
 *
 * The shell used to own the range and traffic toggles and, through the
 * `projectApp` loader, the analytics fetch behind them — which meant Settings
 * rendered under a control it had no use for and paid for ten aggregate
 * queries to do it. Both moved into the two tabs that render insights, backed
 * by `?range=` / `?traffic=` so crossing between them still shares one
 * selection (see `useAppInsights`).
 *
 * The width cap moved the same way and in the same direction. Capping here was
 * how Settings got a readable measure without the content jumping sideways at
 * every tab change; the cost was that Analytics and Vitals, which want the
 * width, could not have it. Each tab now declares its own: Settings keeps
 * `max-w-3xl`, the rest run full width.
 *
 * What stays is identity: the pair, its address, and when it last reported.
 * Those are true on every tab.
 */
const AppLayout = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter();
  const routerState = useRouterState();

  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);
  const dateTime = useInject(DateTimeProvider);

  const activeRoute = routerState.name ?? "";
  const tabs = instance
    ? appTabsFor(instance, {
        track: capabilityOption(project, "ship", "track"),
        deploy: capabilityOption(project, "ship", "deploy"),
      })
    : [];
  const slug = project?.slug;

  /**
   * A tab that disappears under the reader lands on Overview rather than on an
   * error.
   *
   * Reachable two ways, and neither is exotic: switching to a sibling instance
   * with no sigil while standing on Analytics, and removing a sigil from
   * Settings while the Errors tab is open in another window. The route's own
   * `assertBeacon` covers a fresh navigation; this covers the case where the
   * page is already mounted and the DATA changed underneath it.
   *
   * ⚠️ In an effect rather than during render. A redirect computed while
   * rendering fires on the OUTGOING render of every navigation away, which is
   * the #156 shape that made every sidebar link dead for a month.
   */
  useEffect(() => {
    if (!instance || !slug) return;
    if (!APP_TAB_ROUTES.has(activeRoute)) return;
    if (tabs.some((tab) => tab.route === activeRoute)) return;
    void router.push("app", {
      params: { projectSlug: slug, app: instance.app, env: instance.env },
    });
  }, [activeRoute, instance, router, slug, tabs]);

  if (!project || !instance) {
    return null;
  }

  const sigil = instance.sigil;
  const url = appUrl(instance);
  const params = {
    projectSlug: project.slug,
    app: instance.app,
    env: instance.env,
  };

  // The whole analytics question lives in the URL, so crossing between
  // Analytics and Vitals has to carry it across or the link itself resets what
  // it used to preserve. Only for the two tabs that read it: a `?range=`
  // trailing onto Settings would be the control-that-changes-nothing all over
  // again, in the address bar.
  //
  // Vitals honours only `path` of the five dimension filters, and carrying the
  // other four is deliberate rather than sloppy: they are inert there and
  // still there when you cross back, which is what makes the tab bar a
  // navigation rather than a reset.
  const filters: Record<string, string> = {};
  for (const key of ["range", "traffic", ...APP_INSIGHTS_FILTER_KEYS]) {
    const value = router.query[key];
    if (value) {
      filters[key] = value;
    }
  }

  const plateTabs: PlateTab[] = tabs.map((tab) => {
    const carriesFilters =
      tab.route === "appAnalytics" || tab.route === "appVitals";
    return {
      key: tab.route,
      label: tr(tab.labelKey),
      // Each tab is its own route, so each is a link.
      href: router.path(tab.route, {
        params,
        query: carriesFilters ? filters : undefined,
      }),
    };
  });

  return (
    <PlateLayout
      // Marks the tab bar. "Settings" is also a project-level nav entry, so a
      // page-wide `getByRole("link", { name })` cannot say which one it found.
      tabsTestId="app-tabs"
      tabs={plateTabs}
      active={activeRoute}
      // Explore and Deploy own their scrolling. Deploy's history is a
      // `DataTable` that fills the plate and scrolls its own rows.
      // `AdminAnalytics` is a two-pane layout that
      // never scrolls as a page - only the panel's clause list and the results
      // grid do - and it says so on itself. Handing it a scroll region would
      // give it a second scrollbar and, more to the point, a height it can
      // grow past instead of one it fills: `flex-1` inside an `overflow-y-auto`
      // box resolves against the CONTENT, so the builder ended up short of the
      // plate rather than filling it.
      //
      // Keyed on the route rather than on a flag each tab sets, because the
      // property belongs to the tab's layout and `PlateLayout` is rendered
      // once here, above the tab that would set it.
      scroll={activeRoute !== "appExplore" && activeRoute !== "appDeploy"}
      plate={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 pb-3">
          {/*
            The pair, split: the app muted and the copy at full strength. Two
            instances of one app differ in the second half, and that is the half
            a reader is looking for.
          */}
          {/*
            The same dot as the copy's row on the Apps list, so the page
            says whether it is alive before the tabs say anything.
          */}
          <h1 className="flex items-center gap-2.5 text-xl font-semibold">
            <AppStatusDot state={appLiveness(instance, dateTime.nowMillis())} />
            <span>
              <span className="text-muted-foreground font-normal">
                {instance.app} /{" "}
              </span>
              {instance.env}
            </span>
          </h1>

          {/*
          The copy's own address, beside its name. A plain `<a>` rather than the
          router's `Link`: this is the one link on the page that leaves Lore.
          `noopener` because `_blank` otherwise hands `window.opener` to a page
          Lore does not control, and `nofollow` because a deployed copy is not
          an endorsement Lore is making.

          Identity, not a control — it says what this is, so it belongs beside
          the name on every tab and did not move with the toggles.

          Absent when nothing knows the address yet, which is a real state: a
          copy that has never reported and whose operator has pinned nothing has
          no address to show, and an empty slot says that better than a
          placeholder would.
        */}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-muted-foreground hover:text-foreground ml-3 inline-flex items-center gap-1 text-xs transition-colors"
            >
              {appUrlLabel(url)}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}

          {/*
            Pushed to the right edge, and absent rather than "never reported"
            when there is no sigil: a copy nobody wired telemetry into has not
            failed to report, it was never asked to.
          */}
          {sigil && (
            <span className="text-muted-foreground ml-auto text-xs">
              {sigil.lastSeenAt ? (
                <>
                  {tr("sigils.lastSeen")}{" "}
                  {/*
                    Relative, because the question here is "is it alive", and
                    the dotted underline says the exact time is a hover away.
                    `ClientOnly` because a `fromNow` string differs between the
                    server render and hydration; the server writes the exact
                    form instead, as `TimeAgo` does. Not `TimeAgo` itself: its
                    native `title` would stack a second tooltip on this one.
                  */}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="text-foreground cursor-help underline decoration-dotted underline-offset-4" />
                      }
                    >
                      <ClientOnly
                        fallback={l(sigil.lastSeenAt, { date: "lll" })}
                      >
                        {l(sigil.lastSeenAt, { date: "fromNow" })}
                      </ClientOnly>
                    </TooltipTrigger>
                    <TooltipContent>
                      {l(sigil.lastSeenAt, { date: "llll" })}
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : (
                tr("sigils.neverSeen")
              )}
            </span>
          )}
        </div>
      }
    >
      {/* Per-tab width rules stay inside the tabs, where they moved when the
          shell stopped capping them: Settings keeps `max-w-3xl`, the rest run
          full width. The PADDING moved in with them for the same reason
          (#1747, feedback #2078): it used to be a shared `p-4` here, which
          Explore had no way to opt out of, so the query builder sat in a
          gutter with a strip of plate showing underneath it. Overview,
          Analytics, Vitals and Settings each carry their own `p-4`
          and render identically; Explore carries none. ⚠️ These tabs are card
          and chart surfaces, not tables, so the 8px frame #Q2266 gave the
          table pages is not theirs: it was applied here too and reverted by
          #Q2291. */}
      <NestedView />
    </PlateLayout>
  );
};

export default AppLayout;
