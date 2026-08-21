import { Button } from "@alepha/ui/components/ui/button";
import { useAlepha, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowRight, Search, Sparkles } from "lucide-react";

import type { AppRouter } from "../../AppRouter.ts";
import { spotlightOpenAtom } from "../../atoms/spotlightOpenAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { RECENT_PROJECTS_CAP } from "../project/recentProjectsCap.ts";
import LoreLogo from "../shared/LoreLogo.tsx";
import DashboardRailProject from "./DashboardRailProject.tsx";

/**
 * The left rail: search, the projects, and the way to make another one.
 *
 * ⚠️ The list is **sliced for display only**. `userProjectsAtom` stays the
 * complete membership list, because Spotlight's client-side project search
 * filters that array — a truncated atom would quietly reduce ⌘K to finding
 * whichever five sorted highest. See `recentProjectsCap.ts`, which carries
 * the same warning for Home.
 *
 * The search box opens the Spotlight rather than being its own input: ⌘K
 * already works from any page (it is mounted in `Layout`), and a second
 * search field beside it would be two ways to do one thing.
 *
 * Hidden below `lg`. The mockup is a 320px rail on a desktop canvas, and at
 * phone width the tiles are the page.
 */
const DashboardRail = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const [overview] = useStore(userProjectsAtom);

  const projects = [...(overview?.projects ?? [])].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  const shown = projects.slice(0, RECENT_PROJECTS_CAP);
  const hasMore = projects.length > RECENT_PROJECTS_CAP;

  return (
    <aside
      data-testid="dashboard-rail"
      className="border-border bg-card/40 hidden w-80 shrink-0 flex-col gap-1.5 border-r px-4 py-5 lg:flex"
    >
      <div className="flex items-center gap-2.5 px-1.5 pb-3.5">
        <LoreLogo size={26} className="size-[26px]" />
        <span className="text-muted-foreground text-[11px] uppercase tracking-[0.18em]">
          Alepha Lore
        </span>
      </div>

      <button
        type="button"
        onClick={() => alepha.store.set(spotlightOpenAtom, { open: true })}
        data-testid="dashboard-rail-search"
        className="border-border bg-background text-muted-foreground hover:text-foreground mb-3 flex h-[34px] items-center gap-2 rounded-[9px] border px-2.5 text-[13px] transition-colors"
      >
        <Search className="size-3.5" />
        {tr("dashboard.search")}
        <span className="flex-1" />
        <span className="font-mono text-[11px]">⌘K</span>
      </button>

      <div className="text-muted-foreground px-1.5 pb-2 text-[11px] font-medium uppercase tracking-[0.06em]">
        {tr("dashboard.projects")}
      </div>

      {shown.map((project) => (
        <DashboardRailProject
          key={project.id}
          project={project}
          href={router.path("project", {
            params: { projectSlug: project.slug },
          })}
        />
      ))}

      {hasMore && (
        <Link
          href={router.path("accountProjects")}
          data-testid="dashboard-rail-see-all"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-1.5 py-2 text-[12.5px] transition-colors"
        >
          {tr("dashboard.seeAll", { args: [String(projects.length)] })}
          <ArrowRight className="size-3.5" />
        </Link>
      )}

      <span className="flex-1" />

      <Button
        render={<Link href={router.path("projectCreate")} />}
        className="h-[38px] justify-start rounded-[10px] px-3 text-[13.5px]"
      >
        <Sparkles className="size-4" />
        {tr("dashboard.newProject")}
      </Button>
    </aside>
  );
};

export default DashboardRail;
