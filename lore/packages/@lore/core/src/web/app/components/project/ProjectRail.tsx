import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@alepha/ui";
import { useAlepha, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Home, LayoutGrid, Plus } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { recentProjectsAtom } from "../../atoms/recentProjectsAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import { ProjectRailCard } from "./ProjectRailCard.tsx";
import { projectRailOrder } from "./projectRailOrder.ts";
import { RECENT_PROJECTS_CAP } from "./recentProjectsCap.ts";

/**
 * A column of project icons left of the sidebar: one click switches project
 * (#Q3366). Desktop only; at phone width the switcher in the sidebar stays
 * the way to change project.
 *
 * Home at the top, then up to ten projects, then New project and All
 * projects (#Q3374). Shown from the first project: on desktop it is the only
 * way to switch, the sidebar header being a plain title there. Hovering an
 * icon opens a card with the project's image, name and repository (#Q3370).
 *
 * ⚠️ **Selecting a project never moves it.** A rail is used by position, so
 * the order is the viewer's own and stays put (#Q3370; #Q3366 moved the last
 * opened to the top on the next load, and the owner asked for it to stop).
 * `recentProjectsAtom` holds the order as shown: the first time, the projects
 * by last update; afterwards a project already on the rail keeps its slot, and
 * one opened from outside it (All projects, a link) takes the last slot.
 */
const ProjectRail = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const alepha = useAlepha();
  const [project] = useStore(currentProjectAtom);
  const [overview] = useStore(userProjectsAtom);
  const [opened] = useStore(recentProjectsAtom);

  const projects = overview?.projects ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxProjects = overview?.maxProjects;
  const shown = project
    ? projectRailOrder(projects, opened ?? [], project.id, RECENT_PROJECTS_CAP)
    : [];
  const shownKey = shown.map((it) => it.id).join(",");

  // Store the order as shown, so the next page load draws the same rail. A
  // no-op when nothing changed, which is every visit to a project already on
  // the rail.
  useEffect(() => {
    if (!shownKey) return;
    const current = (alepha.store.get(recentProjectsAtom) ?? []).join(",");
    if (current === shownKey) return;
    alepha.store.set(recentProjectsAtom, shownKey.split(",").map(Number));
  }, [alepha, shownKey]);

  if (!project) {
    return null;
  }

  return (
    <nav
      aria-label={tr("project.rail.label")}
      data-testid="project-rail"
      className="hidden w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r py-2.5 md:flex"
    >
      <RailButton
        label={tr("home.nav")}
        testId="project-rail-home"
        href={router.path("home")}
      >
        <Home className="size-4" />
      </RailButton>
      <RailSeparator />
      {shown.map((it) => {
        const active = it.id === project.id;
        return (
          <HoverCard key={it.id}>
            <HoverCardTrigger
              // One second (#Q3413): at 150 ms a card flashed open for every
              // icon the pointer crossed on its way down the rail.
              delay={1000}
              closeDelay={100}
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
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" sideOffset={12}>
              <ProjectRailCard project={it} />
            </HoverCardContent>
          </HoverCard>
        );
      })}
      <RailSeparator />
      <RailButton
        label={
          canCreate || !maxProjects
            ? tr("home.create-project")
            : `${tr("home.create-project")}: ${tr("home.create-project.max", { args: [String(maxProjects)] })}`
        }
        testId="project-rail-create"
        href={canCreate ? router.path("projectCreate") : undefined}
      >
        <Plus className="size-4" />
      </RailButton>
      <RailButton
        label={tr("account.projects.see-all")}
        testId="project-rail-all"
        href={router.path("accountProjects")}
      >
        <LayoutGrid className="size-4" />
      </RailButton>
    </nav>
  );
};

const RailSeparator = () => (
  <span aria-hidden className="bg-border my-0.5 h-px w-8 shrink-0" />
);

/**
 * A round icon button with a tooltip: Home, New project, All projects. With
 * no `href` it is drawn disabled (New project once the quota is reached), its
 * tooltip saying why.
 */
const RailButton = (props: {
  label: string;
  testId: string;
  href?: string;
  children: ReactNode;
}) => {
  const className =
    "bg-background text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-2xl border transition-[border-radius,color] duration-150";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          props.href ? (
            <Link
              href={props.href}
              aria-label={props.label}
              data-testid={props.testId}
              className={cn(
                className,
                "hover:text-foreground hover:rounded-xl",
              )}
            />
          ) : (
            <span
              role="link"
              aria-label={props.label}
              aria-disabled
              data-testid={props.testId}
              className={cn(className, "cursor-not-allowed opacity-50")}
            />
          )
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent side="right">{props.label}</TooltipContent>
    </Tooltip>
  );
};

export default ProjectRail;
