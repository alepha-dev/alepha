import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@alepha/ui";
import { useAlepha, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { recentProjectsAtom } from "../../atoms/recentProjectsAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import { projectRailOrder } from "./projectRailOrder.ts";
import { RECENT_PROJECTS_CAP } from "./recentProjectsCap.ts";

/**
 * A column of project icons left of the sidebar: one click switches project
 * (#Q3366). Desktop only; at phone width the switcher in the sidebar stays
 * the way to change project.
 *
 * Shown once the viewer has two projects to switch between. Up to ten, by
 * when this browser last opened each (`recentProjectsAtom`), then a link to
 * every project.
 *
 * ⚠️ **The order is read once, when the rail mounts, and never moves while
 * it is on screen.** Opening a project records it at once, but the icons only
 * take the new order on the next page load: a rail is used by position, and
 * an icon that jumps to the top as you click it sends the next click to the
 * wrong project.
 */
const ProjectRail = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const alepha = useAlepha();
  const [project] = useStore(currentProjectAtom);
  const [overview] = useStore(userProjectsAtom);
  const [opened] = useStore(recentProjectsAtom);
  const [frozen] = useState(() => opened ?? []);

  const projectId = project?.id;
  useEffect(() => {
    if (projectId === undefined) return;
    const current = alepha.store.get(recentProjectsAtom) ?? [];
    if (current[0] === projectId) return;
    alepha.store.set(
      recentProjectsAtom,
      [projectId, ...current.filter((id) => id !== projectId)].slice(
        0,
        RECENT_PROJECTS_CAP,
      ),
    );
  }, [alepha, projectId]);

  const projects = overview?.projects ?? [];
  const live = projects.filter((it) => !it.archivedAt);
  if (!project || live.length < 2) {
    return null;
  }

  const shown = projectRailOrder(
    projects,
    frozen,
    project.id,
    RECENT_PROJECTS_CAP,
  );

  return (
    <nav
      aria-label={tr("project.rail.label")}
      data-testid="project-rail"
      className="hidden w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto py-2.5 md:flex"
    >
      {shown.map((it) => {
        const active = it.id === project.id;
        return (
          <Tooltip key={it.id}>
            <TooltipTrigger
              render={
                <Link
                  href={router.path("project", {
                    params: { projectSlug: it.slug },
                  })}
                  aria-label={it.title}
                  aria-current={active ? "page" : undefined}
                  data-testid="project-rail-item"
                  className="group/rail relative flex"
                />
              }
            >
              {/* The marker on the rail's edge: full height on the current
                  project, a short notch under the pointer elsewhere. */}
              <span
                aria-hidden
                className={cn(
                  "bg-foreground absolute top-1/2 -left-3 w-1 -translate-y-1/2 rounded-r-full transition-[height] duration-150",
                  active ? "h-8" : "h-0 group-hover/rail:h-4",
                )}
              />
              <ProjectIcon
                fileId={it.icon}
                title={it.title}
                seed={it.slug}
                className={cn(
                  "size-10 transition-[border-radius] duration-150",
                  active
                    ? "ring-ring/40 rounded-xl ring-2"
                    : "rounded-2xl group-hover/rail:rounded-xl",
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="right">{it.title}</TooltipContent>
          </Tooltip>
        );
      })}
      <span aria-hidden className="bg-border my-0.5 h-px w-8 shrink-0" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={router.path("accountProjects")}
              aria-label={tr("account.projects.see-all")}
              data-testid="project-rail-all"
              className="bg-background text-muted-foreground hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-2xl border transition-[border-radius,color] duration-150 hover:rounded-xl"
            />
          }
        >
          <LayoutGrid className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="right">
          {tr("account.projects.see-all")}
        </TooltipContent>
      </Tooltip>
    </nav>
  );
};

export default ProjectRail;
