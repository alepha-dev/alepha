import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@alepha/ui";
import { useSettingsDialog } from "@alepha/ui/settings";
import { DndContext, useSortableList } from "@alepha/ui/sortable";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter, useRouterState } from "alepha/react/router";
import { Home, LayoutGrid, Plus } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { USER_DOCK_CAP } from "../../../../api/schemas/userDockCap.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userDockAtom } from "../../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectRailItem } from "./ProjectRailItem.tsx";
import { ProjectRailMenu } from "./ProjectRailMenu.tsx";
import { useDock } from "./useDock.ts";
import { useDockUnread } from "./useDockUnread.ts";
import { useLeavingProject } from "./useLeavingProject.ts";

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
 * - Reordered by dragging a pinned icon onto another, or from the keyboard:
 *   Space picks the focused icon up, the arrows move it, Space or Enter drops
 *   it and Escape puts it back (#Q3438). Saved on the drop, optimistically.
 * - Right-click an icon for Unpin (Pin on the temporary slot), Open in new
 *   tab and Copy link (#Q3439).
 *
 * ⚠️ **Selecting a project never moves it.** A dock is used by position, so
 * its order is changed only by the viewer, on the dock (#Q3370).
 */
const ProjectRail = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const account = useSettingsDialog("account");
  const [project] = useStore(currentProjectAtom);
  // The icon clicked is marked at once, not when its project has loaded: the
  // atom above names the next project only halfway through the switch.
  const routerState = useRouterState();
  const leavingTo = useLeavingProject(routerState.params.projectSlug);
  const [overview] = useStore(userProjectsAtom);
  const [dock] = useStore(userDockAtom);
  const actions = useDock();
  const hintId = useId();
  const pinsRef = useRef<HTMLDivElement | null>(null);
  // Set while a pointer drag runs, read by the click its pointerup fires.
  const dropped = useRef(false);

  const projects = overview?.projects ?? [];
  // The server already narrows the dock to live, unarchived memberships;
  // matching against the list in memory also keeps a project this tab just
  // left or archived from lingering until the next load.
  const byId = new Map(projects.map((it) => [it.id, it]));
  const pinned = (dock ?? [])
    .map((id) => byId.get(id))
    .filter((it) => it !== undefined && !it.archivedAt)
    .map((it) => it!);
  const titleOf = (id: number) => byId.get(id)?.title ?? "";
  // The shared sortable list (#Q4128): a drop or a keyboard step is drawn at
  // once, and `move` draws the new order in the atom and saves it.
  const list = useSortableList<number>({
    ids: pinned.map((it) => it.id),
    labelOf: titleOf,
    onReorder: (next) => void actions.move(next),
    announcements: {
      picked: (title) => tr("dock.reorder.picked", { args: [title] }),
      moved: (title, at, total) =>
        tr("dock.reorder.moved", { args: [title, String(at), String(total)] }),
      dropped: (title) => tr("dock.reorder.dropped", { args: [title] }),
      cancelled: (title) => tr("dock.reorder.cancelled", { args: [title] }),
    },
    // A drop's click is held from the moment a drag starts until the next
    // press: the pointerup that drops an icon also clicks the link under it.
    onDragStart: () => {
      dropped.current = true;
    },
  });
  const picked = list.picked;
  const ids = pinned.map((it) => it.id);
  const shownPins = list.order
    .map((id) => byId.get(id))
    .filter((it) => it !== undefined)
    .map((it) => it!);

  // The click a drop ends with must not follow the link it was released
  // on. dnd-kit stops that click's propagation at `document`, so no React
  // handler ever hears it, but it does not prevent its default: the anchor
  // then navigates natively, reloading the page and dropping the save in
  // flight. Prevented here, from `window`, which the event reaches first.
  useEffect(() => {
    const swallow = (event: MouseEvent) => {
      if (dropped.current) event.preventDefault();
    };
    window.addEventListener("click", swallow, true);
    return () => window.removeEventListener("click", swallow, true);
  }, []);

  // The keyboard move re-renders the list, which can take focus off the icon
  // being moved: give it back.
  useEffect(() => {
    if (picked === undefined) return;
    pinsRef.current
      ?.querySelector<HTMLElement>(
        `[data-testid="project-rail-item"][data-project-id="${picked}"]`,
      )
      ?.focus();
  }, [picked, list.order.join(",")]);

  // Every docked project's unread, in one request (#Q3981): the pins and
  // the current project. Above the early return, as every hook is.
  const unread = useDockUnread([
    ...ids,
    ...(project && !ids.includes(project.id) ? [project.id] : []),
  ]);

  if (!project) {
    return null;
  }

  const canCreate = overview?.canCreate ?? true;
  const maxProjects = overview?.maxProjects;
  const temporary = ids.includes(project.id)
    ? undefined
    : (byId.get(project.id) ?? project);
  const unreadLabel = (id: number) => {
    const n = unread.get(id) ?? 0;
    return n
      ? tr(n === 1 ? "project.rail.unread.one" : "project.rail.unread", {
          args: [String(n)],
        })
      : undefined;
  };
  const full = ids.length >= USER_DOCK_CAP;
  const busy = actions.pin.loading || actions.unpin.loading;

  return (
    <nav
      aria-label={tr("project.rail.label")}
      data-testid="project-rail"
      className="hidden w-16 shrink-0 flex-col items-center md:flex"
    >
      <span id={hintId} className="sr-only">
        {tr("dock.reorder.hint")}
      </span>
      <span aria-live="assertive" className="sr-only">
        {list.announcement}
      </span>
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
      <DndContext {...list.contextProps}>
        <div
          ref={pinsRef}
          data-testid="project-rail-pins"
          // A new press is a new gesture: a click is a click again. Capture,
          // so it runs before the icon's own drag listener.
          onPointerDownCapture={() => {
            dropped.current = false;
          }}
          // `px` leaves room for the marker and the ring, which an
          // `overflow` container would otherwise clip. Vertical only
          // (#Q3481): the content runs a pixel wider than the rail's 63px
          // (its 64px less the border), and `overflow-y-auto` alone makes
          // the other axis `auto` too. `flex-initial`, never `flex-1`
          // (#Q3484): the list is as tall as its projects, so + and the grid
          // follow the last one, and it shrinks and scrolls only once they
          // no longer fit, which leaves those two at the bottom.
          className="flex min-h-0 w-full flex-initial [scrollbar-width:none] flex-col items-center gap-2 overflow-x-hidden overflow-y-auto px-3 py-1"
        >
          {shownPins.map((it) => (
            <ProjectRailItem
              key={it.id}
              project={it}
              active={leavingTo ? it.slug === leavingTo : it.id === project.id}
              dragging={list.dragging}
              picked={picked === it.id}
              unread={unread.get(it.id)}
              unreadLabel={unreadLabel(it.id)}
              onKeyDown={list.onKeyDown(it.id)}
              describedBy={hintId}
              menu={
                <ProjectRailMenu
                  project={it}
                  pinned
                  full={full}
                  busy={busy}
                  onPin={() => {}}
                  onUnpin={() => void actions.unpin.run(it.id)}
                />
              }
            />
          ))}
          {temporary && (
            <ProjectRailItem
              key="temporary"
              project={temporary}
              active
              temporary
              unread={unread.get(temporary.id)}
              unreadLabel={unreadLabel(temporary.id)}
              menu={
                <ProjectRailMenu
                  project={temporary}
                  pinned={false}
                  full={full}
                  busy={busy}
                  onPin={() => void actions.pin.run(temporary.id)}
                  onUnpin={() => {}}
                />
              }
            />
          )}
        </div>
      </DndContext>
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
          onClick={() => account.open("projects")}
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
 * A round icon button with a tooltip: Home, New project, All projects. A link
 * with an `href`, a button with an `onClick` (All projects opens the account
 * dialog, which has no URL). With neither it is drawn disabled (New project
 * once the quota is reached), its tooltip saying why.
 */
const RailButton = (props: {
  label: string;
  testId: string;
  href?: string;
  onClick?: () => void;
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
          ) : props.onClick ? (
            <button
              type="button"
              onClick={props.onClick}
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
