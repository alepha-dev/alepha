import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

type RouteName = "reportsOverview" | "reportsQuests" | "reportsMembers";

type NavLabelKey =
  | "project.reports.nav.overview"
  | "project.reports.nav.quests"
  | "project.reports.nav.members";

interface ReportsTab {
  route: RouteName;
  labelKey: NavLabelKey;
}

const TABS: ReportsTab[] = [
  { route: "reportsOverview", labelKey: "project.reports.nav.overview" },
  { route: "reportsQuests", labelKey: "project.reports.nav.quests" },
  { route: "reportsMembers", labelKey: "project.reports.nav.members" },
];

/**
 * Flat Reports shell — a horizontal tab sub-nav (Overview / Quests / Members)
 * above a `<NestedView />` that renders the active child page.
 */
const ReportsLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();

  const activeRoute = routerState.name ?? "";

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const isActive = activeRoute === tab.route;
          const href = router.path(tab.route);
          return (
            <Link
              key={tab.route}
              href={href}
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

      <div className="flex flex-col gap-8 pt-6">
        <NestedView />
      </div>
    </div>
  );
};

export default ReportsLayout;
