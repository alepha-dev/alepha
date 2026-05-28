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

type RouteName = "chroniclesOverview" | "chroniclesQuests" | "chroniclesParty";

type NavLabelKey =
  | "campaign.chronicles.nav.overview"
  | "campaign.chronicles.nav.quests"
  | "campaign.chronicles.nav.party";

interface ChroniclesTab {
  route: RouteName;
  labelKey: NavLabelKey;
}

const TABS: ChroniclesTab[] = [
  { route: "chroniclesOverview", labelKey: "campaign.chronicles.nav.overview" },
  { route: "chroniclesQuests", labelKey: "campaign.chronicles.nav.quests" },
  { route: "chroniclesParty", labelKey: "campaign.chronicles.nav.party" },
];

/**
 * Flat Chronicles shell — a horizontal tab sub-nav (Overview / Quests / Party)
 * above a `<NestedView />` that renders the active child page.
 */
const ChroniclesLayout = () => {
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

export default ChroniclesLayout;
