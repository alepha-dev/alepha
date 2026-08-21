import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import type { InsightsController } from "@/api/controllers/InsightsController.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { currentSigilInsightsAtom } from "../../../atoms/currentSigilInsightsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

type RouteName = "app" | "appAnalytics" | "appPerformance" | "appSettings";

type TabLabelKey =
  | "app.tab.dashboard"
  | "app.tab.analytics"
  | "app.tab.performance"
  | "app.tab.settings";

interface AppTab {
  route: RouteName;
  labelKey: TabLabelKey;
  /**
   * Whether the tab's data source has to be on for the tab to exist. Analytics
   * and Performance read what Beacon collects; Dashboard and Settings are
   * about the app itself, which exists either way.
   */
  needsBeacon?: boolean;
}

const TABS: AppTab[] = [
  { route: "app", labelKey: "app.tab.dashboard" },
  { route: "appAnalytics", labelKey: "app.tab.analytics", needsBeacon: true },
  {
    route: "appPerformance",
    labelKey: "app.tab.performance",
    needsBeacon: true,
  },
  { route: "appSettings", labelKey: "app.tab.settings" },
];

type Range = "1d" | "7d" | "30d";
const RANGES: Range[] = ["1d", "7d", "30d"];

/**
 * One enrolled app: a header naming it, a tab bar, and the range toggle every
 * tab below shares.
 *
 * The range lives here rather than on each tab because it is one question asked
 * of one app — moving between Analytics and Performance should not silently reset it
 * to seven days. The refetch writes `currentSigilInsightsAtom`, which is what
 * the tabs render; a failed one rolls the toggle back to the range the data on
 * screen actually belongs to and says so, rather than leaving the two
 * disagreeing.
 */
const AppLayout = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const toaster = useToast();
  const insightsApi = useClient<InsightsController>();

  const [project] = useStore(currentProjectAtom);
  const [sigil] = useStore(currentSigilAtom);
  const [insights, setInsights] = useStore(currentSigilInsightsAtom);

  const [range, setRange] = useState<Range>(insights?.range ?? "7d");
  const [loading, setLoading] = useState(false);

  if (!project || !sigil) {
    return null;
  }

  const activeRoute = routerState.name ?? "";
  const params = { projectId: String(project.id), appName: sigil.name };
  // The app's own capability, not the project's. Analytics and Performance
  // both read what Beacon collects, and an app that does not carry it has
  // nothing behind either tab.
  const collectsBeacon = sigil.kinds.includes("beacon");
  const tabs = TABS.filter((tab) => !tab.needsBeacon || collectsBeacon);

  const changeRange = async (next: Range) => {
    if (next === range) return;
    const previous = range;
    setRange(next);
    setLoading(true);
    try {
      const res = await insightsApi.getInsights({
        params: { projectId: project.id },
        query: { range: next, sigilId: sigil.id },
      });
      setInsights(res);
    } catch (error) {
      // A failed range fetch leaves stale data on screen — surface it and roll
      // the toggle back so it names the range the data actually covers.
      setRange(previous);
      toaster.error(
        error instanceof Error ? error.message : tr("insights.error"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    // Centred here, on the LAYOUT, rather than on the Settings tab alone.
    // Settings was the tab that looked wrong — capped at `max-w-3xl` and hard
    // against the left edge — but capping and centring only that one would make
    // the content jump sideways every time you crossed the tab bar, since
    // Dashboard / Analytics / Performance have no measure of their own. One
    // wrapper gives every tab the same rhythm, and the title and tab bar move
    // with them because they live inside it.
    //
    // `max-w-6xl` matches the project Settings page's own wrapper rather than
    // inventing a third measure. Not the two-column skeleton though: this page
    // already has a horizontal tab bar, and a section rail beside it would be
    // two competing navigations.
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-4 md:pt-10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">{sigil.name}</h1>
        <span className="text-muted-foreground text-xs">
          {sigil.lastSeenAt
            ? tr("sigils.lastSeen", {
                args: [String(l(sigil.lastSeenAt, { date: "lll" }))],
              })
            : tr("sigils.neverSeen")}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        {/*
          Marks the tab bar. "Settings" is also a project-level nav entry, so a
          page-wide `getByRole("link", { name })` cannot say which one it found.
        */}
        <div data-testid="app-tabs" className="flex gap-1">
          {tabs.map((tab) => {
            const isActive = activeRoute === tab.route;
            return (
              <Link
                key={tab.route}
                href={router.path(tab.route, { params })}
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tr(tab.labelKey)}
              </Link>
            );
          })}
        </div>

        {collectsBeacon && (
          <div className="flex items-center gap-2 pb-1">
            {loading && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )}
            <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => void changeRange(r)}
                  className={
                    r === range
                      ? "bg-background rounded px-3 py-1 text-xs font-medium shadow-sm"
                      : "text-muted-foreground rounded px-3 py-1 text-xs"
                  }
                >
                  {tr(`insights.range.${r}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <NestedView />
    </div>
  );
};

export default AppLayout;
