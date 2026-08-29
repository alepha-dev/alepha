import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import { ExternalLink } from "lucide-react";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { appUrl, appUrlLabel } from "./appUrl.ts";

type RouteName = "app" | "appAnalytics" | "appVitals" | "appSettings";

type TabLabelKey =
  | "app.tab.dashboard"
  | "app.tab.analytics"
  | "app.tab.vitals"
  | "app.tab.settings";

interface AppTab {
  route: RouteName;
  labelKey: TabLabelKey;
  /**
   * Whether the tab's data source has to be on for the tab to exist. Analytics
   * and Vitals read what Beacon collects; Dashboard and Settings are about the
   * app itself, which exists either way.
   */
  needsBeacon?: boolean;
}

const TABS: AppTab[] = [
  { route: "app", labelKey: "app.tab.dashboard" },
  { route: "appAnalytics", labelKey: "app.tab.analytics", needsBeacon: true },
  { route: "appVitals", labelKey: "app.tab.vitals", needsBeacon: true },
  { route: "appSettings", labelKey: "app.tab.settings" },
];

/**
 * One enrolled app: a header naming it and a tab bar.
 *
 * Deliberately thin. The shell used to own the range and traffic toggles and,
 * through the `projectApp` loader, the analytics fetch behind them — which
 * meant Settings rendered under a control it had no use for and paid for ten
 * aggregate queries to do it. Both moved into the two tabs that render
 * insights, backed by `?range=` / `?traffic=` so crossing between them still
 * shares one selection (see `useAppInsights`).
 *
 * The width cap moved the same way and in the same direction. Capping here was
 * how Settings got a readable measure without the content jumping sideways at
 * every tab change; the cost was that Analytics and Vitals, which want the
 * width, could not have it. Each tab now declares its own: Settings keeps
 * `max-w-3xl`, the rest run full width.
 *
 * What stays is identity: the app's name, its address, and when it last
 * reported. Those are true on every tab.
 */
const AppLayout = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();

  const [project] = useStore(currentProjectAtom);
  const [sigil] = useStore(currentSigilAtom);

  if (!project || !sigil) {
    return null;
  }

  const activeRoute = routerState.name ?? "";
  const params = { projectSlug: project.slug, appName: sigil.name };
  const url = appUrl(sigil);
  // The app's own capability, not the project's. Analytics and Vitals both
  // read what Beacon collects, and an app that does not carry it has nothing
  // behind either tab.
  const collectsBeacon = sigil.kinds.includes("beacon");
  const tabs = TABS.filter((tab) => !tab.needsBeacon || collectsBeacon);
  // The filters now live in the URL, so crossing between Analytics and Vitals
  // has to carry them across or the link itself resets what it used to
  // preserve. Only for the two tabs that read them: a `?range=` trailing onto
  // Settings would be the control-that-changes-nothing all over again, in the
  // address bar.
  const filters: Record<string, string> = {};
  for (const key of ["range", "traffic"]) {
    const value = router.query[key];
    if (value) {
      filters[key] = value;
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-4 md:pt-10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">{sigil.name}</h1>
        {/*
          The app's own address, beside its name. A plain `<a>` rather than the
          router's `Link`: this is the one link on the page that leaves Lore.
          `noopener` because `_blank` otherwise hands `window.opener` to a page
          Lore does not control, and `nofollow` because an enrolled app is not
          an endorsement Lore is making.

          Identity, not a control — it says what this app is, so it belongs
          beside the name on every tab and did not move with the toggles.

          Absent when nothing knows the address yet, which is a real state: an
          app that has never reported and whose operator has pinned nothing has
          no address to show, and an empty slot says that better than a
          placeholder would.
        */}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
          >
            {appUrlLabel(url)}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        <span className="text-muted-foreground text-xs">
          {sigil.lastSeenAt
            ? tr("sigils.lastSeen", {
                args: [String(l(sigil.lastSeenAt, { date: "lll" }))],
              })
            : tr("sigils.neverSeen")}
        </span>
      </div>

      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b">
        {/*
          Marks the tab bar. "Settings" is also a project-level nav entry, so a
          page-wide `getByRole("link", { name })` cannot say which one it found.
        */}
        <div data-testid="app-tabs" className="flex gap-1">
          {tabs.map((tab) => {
            const isActive = activeRoute === tab.route;
            const carriesFilters =
              tab.route === "appAnalytics" || tab.route === "appVitals";
            return (
              <Link
                key={tab.route}
                href={router.path(tab.route, {
                  params,
                  query: carriesFilters ? filters : undefined,
                })}
                className={cn(
                  "px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  isActive
                    ? "border-primary text-foreground border-b-2"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tr(tab.labelKey)}
              </Link>
            );
          })}
        </div>
      </div>

      <NestedView />
    </div>
  );
};

export default AppLayout;
