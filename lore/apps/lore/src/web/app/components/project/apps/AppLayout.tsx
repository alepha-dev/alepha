import {
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui/components/ui/tooltip";
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

type Traffic = "all" | "humans" | "bots";
const TRAFFICS: Traffic[] = ["all", "humans", "bots"];

/**
 * One enrolled app: a header naming it, a tab bar, and the two toggles that
 * decide what the tabs below are looking at.
 *
 * The range lives here rather than on each tab because it is one question asked
 * of one app — moving between Analytics and Performance should not silently reset it
 * to seven days. The refetch writes `currentSigilInsightsAtom`, which is what
 * the tabs render; a failed one rolls the toggle back to the range the data on
 * screen actually belongs to and says so, rather than leaving the two
 * disagreeing.
 *
 * The traffic toggle sits beside it and keeps its state the same way, but
 * renders on Analytics alone: `sigil_vitals` declares no `traffic` dimension,
 * so on Performance the control would be present and inert. Its state still
 * lives here rather than in the tab, so crossing to Performance and back does
 * not reset it either.
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
  const [traffic, setTraffic] = useState<Traffic>(insights?.traffic ?? "all");
  const [loading, setLoading] = useState(false);

  if (!project || !sigil) {
    return null;
  }

  const activeRoute = routerState.name ?? "";
  const params = { projectSlug: project.slug, appName: sigil.name };
  // The app's own capability, not the project's. Analytics and Performance
  // both read what Beacon collects, and an app that does not carry it has
  // nothing behind either tab.
  const collectsBeacon = sigil.kinds.includes("beacon");
  const tabs = TABS.filter((tab) => !tab.needsBeacon || collectsBeacon);

  /**
   * One fetch for both toggles, because they ask one question together: the
   * payload is a window AND a population, and firing a request per control
   * would let a slow first response overwrite a fresh second one.
   *
   * A failure rolls BOTH controls back, for the reason the range toggle
   * already did on its own: stale data under a control that names something
   * else is worse than an error, since nothing on screen looks wrong.
   */
  const reload = async (next: { range: Range; traffic: Traffic }) => {
    if (next.range === range && next.traffic === traffic) return;
    const previous = { range, traffic };
    setRange(next.range);
    setTraffic(next.traffic);
    setLoading(true);
    try {
      const res = await insightsApi.getInsights({
        params: { projectId: project.id },
        query: {
          range: next.range,
          sigilId: sigil.id,
          traffic: next.traffic,
        },
      });
      setInsights(res);
    } catch (error) {
      setRange(previous.range);
      setTraffic(previous.traffic);
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

      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b">
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

        {collectsBeacon && (
          <div className="flex items-center gap-2 pb-1">
            {loading && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )}
            {/*
              Analytics only. Web vitals carry no `traffic` dimension - a
              histogram of what a crawler's headless Chrome measured is not a
              question anyone has - so on Performance this control would be
              present and inert, which reads as broken rather than as absent.
            */}
            {activeRoute === "appAnalytics" && (
              <UiTooltip>
                {/*
                  The caveat rides on the control itself, because that is where
                  the claim is made. "Humans" means "did not declare itself a
                  crawler" - a scraper driving a real browser sits in that
                  bucket, and only the engagement rate gives it away.
                */}
                <TooltipTrigger
                  render={
                    <div
                      data-testid="app-traffic"
                      className="bg-muted flex gap-0.5 rounded-md p-0.5"
                    >
                      {TRAFFICS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => void reload({ range, traffic: t })}
                          className={
                            t === traffic
                              ? "bg-background rounded px-3 py-1 text-xs font-medium shadow-sm"
                              : "text-muted-foreground rounded px-3 py-1 text-xs"
                          }
                        >
                          {tr(`insights.traffic.${t}`)}
                        </button>
                      ))}
                    </div>
                  }
                />
                <TooltipContent className="max-w-xs">
                  {tr("insights.traffic.note")}
                </TooltipContent>
              </UiTooltip>
            )}

            <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => void reload({ range: r, traffic })}
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
