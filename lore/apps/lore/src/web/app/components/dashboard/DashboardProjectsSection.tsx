import { Button } from "@alepha/ui/components/ui/button";
import { useAlepha, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowRight, Search, Sparkles } from "lucide-react";

import type { AppRouter } from "../../AppRouter.ts";
import { spotlightOpenAtom } from "../../atoms/spotlightOpenAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import DashboardRailProject from "./DashboardRailProject.tsx";
import { recentProjects } from "./recentProjects.ts";

/**
 * The rail's contents, inline under the tiles, for every width the rail is
 * not rendered at.
 *
 * ## Why this and not the rail as a sheet
 *
 * Feedback #2084, from `/` on Chrome/Android at 412x924: no way to select a
 * project at all. `DashboardRail` is `hidden ... lg:flex` and is the only
 * thing on this page carrying the project list, the new-project action and
 * the Spotlight button - and the landing page renders no `AppShell`, so there
 * is no sidebar, no sheet and no trigger to find either. The reporter asked
 * for a sidebar button; a sheet was the other candidate and this is not it,
 * for two reasons.
 *
 * ⚠️ **The breakpoints.** The rail hides at `lg` (1024) while `useIsMobile`
 * flips at 767, so a sheet driven by `useIsMobile` - the only sheet mechanism
 * this app has - would have left 768 to 1023 with no rail AND no sheet: the
 * same bug in a narrower band, and the kind that gets found months later. This
 * section is `lg:hidden`, the exact complement of the rail's `lg:flex`, so
 * that band is covered by construction rather than by remembering.
 *
 * Second, a sheet on this page means a second overlay mechanism on the one
 * surface that deliberately has no `AppShell`, with its own focus trap and its
 * own dismissal, to hold content that fits perfectly well on the page. An
 * inline section is also reachable without a tap.
 *
 * The list, its order and its cap come from `recentProjects` so the two
 * surfaces cannot disagree across a resize.
 */
const DashboardProjectsSection = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const [overview] = useStore(userProjectsAtom);

  const { shown, total, hasMore } = recentProjects(overview?.projects);

  return (
    <section
      data-testid="dashboard-projects-section"
      className="border-border mt-10 flex flex-col gap-1.5 border-t pt-6 lg:hidden"
    >
      <div className="text-muted-foreground px-1.5 pb-2 text-[11px] font-medium tracking-[0.06em] uppercase">
        {tr("dashboard.projects")}
      </div>

      {shown.map((project) => (
        <DashboardRailProject
          key={project.id}
          project={project}
          // Its own name, not the rail's: both are in the DOM at every width
          // (this one is CSS-hidden, not unmounted), so sharing one would make
          // every page-wide selector on it resolve to two elements per
          // project. See the prop's own note.
          testId="dashboard-projects-project"
          href={router.path("project", {
            params: { projectSlug: project.slug },
          })}
        />
      ))}

      {hasMore && (
        <Link
          href={router.path("accountProjects")}
          data-testid="dashboard-projects-see-all"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-1.5 py-2 text-[12.5px] transition-colors"
        >
          {tr("dashboard.seeAll", { args: [String(total)] })}
          <ArrowRight className="size-3.5" />
        </Link>
      )}

      {/* Both of the rail's other doors, which are otherwise unreachable here:
          ⌘K is mounted in `Layout` and still works, but a phone has no ⌘K and
          the one button that opens it lives inside the hidden rail. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => alepha.store.set(spotlightOpenAtom, { open: true })}
          data-testid="dashboard-projects-search"
          className="h-[38px] rounded-[10px] px-3 text-[13.5px]"
        >
          <Search className="size-4" />
          {tr("dashboard.search")}
        </Button>
        <Button
          render={<Link href={router.path("projectCreate")} />}
          // A link wearing a button's clothes, same as the rail's:
          // `nativeButton={false}` stops Base UI assuming a native <button>
          // (it warns otherwise), and `role` puts back the link semantics its
          // non-native branch would overwrite with `role="button"`.
          nativeButton={false}
          role="link"
          data-testid="dashboard-projects-new"
          className="h-[38px] rounded-[10px] px-3 text-[13.5px]"
        >
          <Sparkles className="size-4" />
          {tr("dashboard.newProject")}
        </Button>
      </div>
    </section>
  );
};

export default DashboardProjectsSection;
