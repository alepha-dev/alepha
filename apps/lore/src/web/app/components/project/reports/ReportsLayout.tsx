import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";

import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { reportsTabs } from "./reportsTabs.ts";

/**
 * Flat Reports shell — a horizontal tab sub-nav above a `<NestedView />` that
 * renders the active child page.
 *
 * The tab list is no longer a constant: Quality only exists where
 * `features.quality` is on. See `reportsTabs.ts` for why an ingested tab is
 * gated where a derived one is not.
 */
const ReportsLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);

  const activeRoute = routerState.name ?? "";
  const tabs = reportsTabs(project?.features);

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <div className="border-border flex gap-1 border-b">
        {tabs.map((tab) => {
          const isActive = activeRoute === tab.route;
          const href = router.path(tab.route);
          return (
            <Link
              key={tab.route}
              href={href}
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

      <div className="flex flex-col gap-8 pt-6">
        <NestedView />
      </div>
    </div>
  );
};

export default ReportsLayout;
