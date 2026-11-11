import { HoverCard, HoverCardContent, HoverCardTrigger, cn } from "@alepha/ui";
import { Link, useRouter } from "alepha/react/router";
import { useEffect, useRef } from "react";

import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import { ProjectRailCard } from "./ProjectRailCard.tsx";

export interface ProjectRailItemProps {
  project: {
    id: number;
    title: string;
    slug: string;
    icon?: string | null;
    repositoryUrl?: string | null;
  };
  /**
   * The project being looked at: full-height marker, ring, and scrolled into
   * view when the dock overflows.
   */
  active: boolean;
  /**
   * The faded slot of a current project that is not pinned (#E139): drawn
   * below the pins, saved nowhere.
   */
  temporary?: boolean;
}

/**
 * One project icon on the dock (#E139, #Q3437): a link to the project, with
 * the hover card of #Q3370.
 */
export const ProjectRailItem = (props: ProjectRailItemProps) => {
  const router = useRouter();
  const ref = useRef<HTMLSpanElement | null>(null);
  const { project, active } = props;

  // The middle of the dock scrolls when it overflows: the project being
  // looked at must not sit out of sight below the fold.
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active]);

  return (
    <HoverCard>
      <HoverCardTrigger
        // One second (#Q3413): at 150 ms a card flashed open for every icon
        // the pointer crossed on its way down the rail.
        delay={1000}
        closeDelay={100}
        render={
          <Link
            href={router.path("project", {
              params: { projectSlug: project.slug },
            })}
            aria-label={project.title}
            aria-current={active ? "page" : undefined}
            data-testid={
              props.temporary ? "project-rail-temporary" : "project-rail-item"
            }
            data-project-id={project.id}
            className={cn(
              "group/rail relative flex shrink-0",
              props.temporary && "opacity-50 hover:opacity-100",
            )}
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
        {/* The ref sits here because `Link` forwards none. */}
        <span ref={ref} className="flex">
          <ProjectIcon
            fileId={project.icon}
            title={project.title}
            seed={project.slug}
            className={cn(
              "size-10 transition-[border-radius] duration-150",
              active
                ? "ring-ring/40 rounded-xl ring-2"
                : "rounded-2xl group-hover/rail:rounded-xl",
            )}
          />
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={12}>
        <ProjectRailCard project={project} />
      </HoverCardContent>
    </HoverCard>
  );
};
