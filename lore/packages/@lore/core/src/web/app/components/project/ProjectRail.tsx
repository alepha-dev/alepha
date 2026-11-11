import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@alepha/ui";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Home, LayoutGrid, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userDockAtom } from "../../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectRailItem } from "./ProjectRailItem.tsx";

/**
 * The dock: a column of project icons left of the sidebar, one click switches
 * project (#Q3366, #E139). Desktop only; at phone width the switcher in the
 * sidebar stays the way to change project.
 *
 * - Home at the top, New project and All projects at the bottom, fixed
 *   (#Q3374). Only the icons between them scroll, and the current project is
 *   scrolled into view.
 * - The icons are the viewer's pinned projects, in the order they chose
 *   (`userDockAtom`, stored per account in `user_docks`), at most 20.
 * - A current project that is not pinned shows in a faded temporary slot
 *   below the pins. Nothing is saved: it goes when the viewer leaves it.
 * - Shown on every project page, with no pins too: then only the fixed
 *   buttons and, if any, the temporary slot.
 *
 * ⚠️ **Selecting a project never moves it.** A dock is used by position, so
 * its order is changed only by the viewer, on the dock (#Q3370).
 */
const ProjectRail = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [overview] = useStore(userProjectsAtom);
  const [dock] = useStore(userDockAtom);

  if (!project) {
    return null;
  }

  const projects = overview?.projects ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxProjects = overview?.maxProjects;
  // The server already narrows the dock to live, unarchived memberships;
  // matching against the list in memory also keeps a project this tab just
  // left or archived from lingering until the next load.
  const byId = new Map(projects.map((it) => [it.id, it]));
  const pinned = (dock ?? [])
    .map((id) => byId.get(id))
    .filter((it) => it !== undefined && !it.archivedAt)
    .map((it) => it!);
  const temporary = pinned.some((it) => it.id === project.id)
    ? undefined
    : (byId.get(project.id) ?? project);

  return (
    <nav
      aria-label={tr("project.rail.label")}
      data-testid="project-rail"
      className="hidden w-16 shrink-0 flex-col items-center border-r md:flex"
    >
      <div className="flex shrink-0 flex-col items-center gap-2 pt-2.5">
        <RailButton
          label={tr("home.nav")}
          testId="project-rail-home"
          href={router.path("home")}
        >
          <Home className="size-4" />
        </RailButton>
        <RailSeparator />
      </div>
      <div
        data-testid="project-rail-pins"
        // `px` leaves room for the marker and the ring, which an
        // `overflow` container would otherwise clip.
        className="flex min-h-0 w-full flex-1 [scrollbar-width:none] flex-col items-center gap-2 overflow-y-auto px-3 py-1"
      >
        {pinned.map((it) => (
          <ProjectRailItem
            key={it.id}
            project={it}
            active={it.id === project.id}
          />
        ))}
        {temporary && (
          <ProjectRailItem
            key="temporary"
            project={temporary}
            active
            temporary
          />
        )}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2 pb-2.5">
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
      </div>
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
