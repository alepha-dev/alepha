import {
  ContextMenu,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@alepha/ui";
import { useSortableItem } from "@alepha/ui/sortable";
import { Link, useRouter } from "alepha/react/router";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { ProjectIcon } from "../shared/ProjectIcon.tsx";

export interface ProjectRailItemProps {
  project: {
    id: number;
    title: string;
    slug: string;
    icon?: string | null;
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
   * Some icon of the dock is being dragged: no tooltip opens meanwhile.
   */
  dragging?: boolean;
  /**
   * Picked up by the keyboard, and moving with the arrows (#Q3438).
   */
  picked?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  /**
   * Describes the keyboard reorder to a screen reader.
   */
  describedBy?: string;
  /**
   * The right-click menu's content (`ProjectRailMenu`, #Q3439).
   */
  menu?: ReactNode;
  /**
   * The viewer's unread count in this project (#Q3981): a badge on the
   * icon, capped at 9+, and nothing at zero.
   */
  unread?: number;
  /**
   * What a screen reader hears for the badge, said after the title.
   */
  unreadLabel?: string;
}

/**
 * One project icon on the dock (#E139): a link to the project, its name in a
 * tooltip on hover, as the dock's other buttons have. A pinned one is also a drag handle and a drop target for
 * reordering the dock (#Q3438).
 */
export const ProjectRailItem = (props: ProjectRailItemProps) => {
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const { project, active } = props;
  const sortable = !props.temporary;

  // The shared sortable item (#Q4128).
  const item = useSortableItem(project.id, { disabled: !sortable });
  const { isDragging, isOver } = item;

  // The middle of the dock scrolls when it overflows: the project being
  // looked at must not sit out of sight below the fold.
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active]);

  return (
    // The wrapper carries dnd-kit's refs and pointer listener: `Link`
    // forwards no ref. Only the pointer listener, not `attributes` nor the
    // keyboard one: the link is the
    // focusable element, and the keyboard reorder is the rail's own.
    <div
      ref={(node) => {
        ref.current = node;
        item.ref(node);
      }}
      // In the capture phase: the context-menu and tooltip triggers
      // inside handle `pointerdown` themselves, and a bubbling listener here
      // never heard it, so no drag ever started.
      onPointerDownCapture={item.onPointerDown}
      data-testid="project-rail-slot"
      style={item.style}
      className={cn(
        "relative flex shrink-0 touch-none",
        isDragging && "cursor-grabbing",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger render={<div className="flex" />}>
          <Tooltip
            // A tooltip left open when a drag starts would ride along with
            // the pointer: shut while anything is dragged.
            open={open && !props.dragging}
            onOpenChange={(next) => setOpen(next && !props.dragging)}
          >
            <TooltipTrigger
              render={
                <Link
                  href={router.path("project", {
                    params: { projectSlug: project.slug },
                  })}
                  aria-label={
                    props.unread && props.unreadLabel
                      ? `${project.title}, ${props.unreadLabel}`
                      : project.title
                  }
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
                  (isOver || props.picked) && "ring-primary ring-2",
                  isDragging && "opacity-70 shadow-lg",
                )}
              />
              {props.unread ? (
                <span
                  aria-hidden
                  data-testid="project-rail-badge"
                  className="bg-danger text-danger-foreground ring-sidebar absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2"
                >
                  {props.unread > 9 ? "9+" : props.unread}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipContent side="right" className="text-sm font-semibold">
              {project.title}
            </TooltipContent>
          </Tooltip>
        </ContextMenuTrigger>
        {props.menu}
      </ContextMenu>
    </div>
  );
};
