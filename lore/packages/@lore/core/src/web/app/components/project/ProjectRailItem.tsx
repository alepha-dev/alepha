import {
  ContextMenu,
  ContextMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  cn,
} from "@alepha/ui";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Link, useRouter } from "alepha/react/router";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

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
   * below the pins, saved nowhere, and neither dragged nor dropped onto.
   */
  temporary?: boolean;
  /**
   * Some icon of the dock is being dragged: no hover card opens meanwhile.
   */
  dragging?: boolean;
  /**
   * Picked up by the keyboard, and moving with the arrows (#Q3438).
   */
  picked?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLAnchorElement>) => void;
  /**
   * Swallows the click a pointer drag ends with, so a drop does not also
   * open the project.
   */
  onClickCapture?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /**
   * Describes the keyboard reorder to a screen reader.
   */
  describedBy?: string;
  /**
   * The right-click menu's content (`ProjectRailMenu`, #Q3439).
   */
  menu?: ReactNode;
}

/**
 * One project icon on the dock (#E139): a link to the project, with the hover
 * card of #Q3370. A pinned one is also a drag handle and a drop target for
 * reordering the dock (#Q3438).
 */
export const ProjectRailItem = (props: ProjectRailItemProps) => {
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const { project, active } = props;
  const sortable = !props.temporary;

  const {
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: project.id, disabled: !sortable });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: project.id,
    disabled: !sortable,
  });

  // The middle of the dock scrolls when it overflows: the project being
  // looked at must not sit out of sight below the fold.
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active]);

  return (
    // The wrapper carries dnd-kit's refs and pointer listeners: `Link`
    // forwards no ref. Only the listeners, not `attributes`: the link is the
    // focusable element, and the keyboard reorder is the rail's own.
    <div
      ref={(node) => {
        ref.current = node;
        setDragRef(node);
        setDropRef(node);
      }}
      {...(sortable ? listeners : {})}
      data-testid="project-rail-slot"
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(
        "relative flex shrink-0 touch-none",
        isDragging && "cursor-grabbing",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger render={<div className="flex" />}>
          <HoverCard
            // A card left open when a drag starts would ride along with the
            // pointer: shut while anything is dragged.
            open={open && !props.dragging}
            onOpenChange={(next) => setOpen(next && !props.dragging)}
          >
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
                  aria-describedby={sortable ? props.describedBy : undefined}
                  aria-pressed={props.picked ? true : undefined}
                  data-testid={
                    props.temporary
                      ? "project-rail-temporary"
                      : "project-rail-item"
                  }
                  data-project-id={project.id}
                  draggable={false}
                  onKeyDown={props.onKeyDown}
                  onClickCapture={props.onClickCapture}
                  className={cn(
                    "group/rail relative flex shrink-0 rounded-2xl",
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
              <ProjectIcon
                fileId={project.icon}
                title={project.title}
                seed={project.slug}
                className={cn(
                  "size-10 transition-[border-radius] duration-150",
                  active
                    ? "ring-ring/40 rounded-xl ring-2"
                    : "rounded-2xl group-hover/rail:rounded-xl",
                  // Where a drop lands, and what the keyboard holds.
                  ((isOver && !isDragging) || props.picked) &&
                    "ring-primary ring-2",
                  isDragging && "opacity-70 shadow-lg",
                )}
              />
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" sideOffset={12}>
              <ProjectRailCard project={project} />
            </HoverCardContent>
          </HoverCard>
        </ContextMenuTrigger>
        {props.menu}
      </ContextMenu>
    </div>
  );
};
