import {
  TimeAgo,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Activity,
  ChevronRight,
  Clock,
  ExternalLink,
  FolderOpen,
  MoreVertical,
} from "lucide-react";

import type { HomeActivityRow } from "@/api/schemas/homeActivityRowSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import { activityResourceHref } from "../project/activity/activityResourceHref.ts";
import { homeActivityIcon } from "./homeActivityIcon.tsx";
import { HomeActivityLineDetails } from "./HomeActivityLineDetails.tsx";
import { homeActivityRef } from "./homeActivityRef.ts";

export interface HomeActivityLineProps {
  row: HomeActivityRow;
  /**
   * The project's slug, for the links. Absent when the viewer's membership of
   * that project ended between the feed being read and this render, in which
   * case the line has no actions.
   */
  projectSlug?: string;
  /**
   * Whether the panel is currently showing one project. When it is, the line
   * drops the project's name: every line carries the same one.
   */
  filtered: boolean;
  /**
   * Whether this line is the one open. The panel holds it, so opening a line
   * closes the previous one, as Folio History does.
   */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One event, laid out like a Folio History revision: an icon, who did what to
 * which resource, when, and a chevron. A click expands it in place to the
 * rest of the event; the menu holds the ways out of the panel.
 *
 * ## The verb is the raw `action`
 *
 * `create`, `complete`, `publish`, `shelve`. Not a sentence like "shelved the
 * quest": the set is open (every `$audit` declaration adds to it, and a new
 * one reaches this panel the day it is written), so a phrase per action would
 * be a translation key that does not exist yet for the newest verb. The
 * project's Activity table prints the same raw verb, so the two read alike.
 */
export const HomeActivityLine = (props: HomeActivityLineProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const row = props.row;
  const reference = homeActivityRef(row);
  // What "See …" names the resource by: its reference, or its title for a
  // kind addressed by a UUID.
  const seeLabel = reference ?? row.description;
  const href = props.projectSlug
    ? activityResourceHref(props.projectSlug, row)
    : undefined;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={props.expanded}
        onClick={props.onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onToggle();
          }
        }}
        // The chrome band, the same one the panel's own header and a table's
        // filter bar wear: `bg-muted` under the `--bevel` fold. It makes each
        // event a head with its details under it, rather than a paragraph in
        // a list. The hover wash sits on top of the band, which is what a
        // translucent `--hover` is for.
        className="bg-muted hover:bg-hover flex cursor-pointer items-center gap-2 px-4 py-2.5 shadow-[inset_0_1px_0_0_var(--bevel)] transition-colors select-none"
      >
        <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
          {homeActivityIcon(row.type)}
        </span>
        <div className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm leading-tight">
            <span className="font-medium">
              {row.isMe
                ? tr("home.activity.you")
                : (row.actor ?? tr("home.activity.unknown"))}
            </span>{" "}
            <span className="text-muted-foreground">
              {row.action}
              {(row.eventCount ?? 1) > 1 && (
                <span className="tabular-nums"> ×{row.eventCount}</span>
              )}
            </span>
            {reference ? (
              <span className="font-mono text-xs"> {reference}</span>
            ) : (
              // No reference to print (a UUID-addressed kind such as an
              // estate): the resource's own name stands in for it.
              row.description && <span> {row.description}</span>
            )}
          </span>
          <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-[11px] leading-tight">
            <Clock className="size-3 shrink-0" />
            <span className="shrink-0">
              <TimeAgo value={row.createdAt} />
            </span>
            {!props.filtered && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{row.projectTitle}</span>
              </>
            )}
          </span>
        </div>
        {props.projectSlug && (
          // Intercepts clicks so the menu never toggles the row.
          // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={tr("home.activity.actions")}
                  />
                }
              >
                <MoreVertical className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {href && seeLabel && (
                  <>
                    <DropdownMenuItem render={<Link href={href} />}>
                      <ExternalLink className="size-4" />
                      {tr("home.activity.see", { args: [seeLabel] })}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  render={
                    <Link
                      href={router.path("project", {
                        params: { projectSlug: props.projectSlug },
                      })}
                    />
                  }
                >
                  <FolderOpen className="size-4" />
                  {tr("home.activity.openProject")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={
                    <Link
                      href={router.path("projectActivity", {
                        params: { projectSlug: props.projectSlug },
                      })}
                    />
                  }
                >
                  <Activity className="size-4" />
                  {tr("home.activity.projectActivity")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
          <ChevronRight
            className={cn(
              "size-4 transition-transform duration-200",
              props.expanded && "rotate-90",
            )}
          />
        </span>
      </div>

      {/* Animated collapse: grid-rows 0fr→1fr interpolates height without
          measuring, the same as Folio History. The body stays mounted so it
          transitions. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          props.expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t px-4 py-2.5">
            <HomeActivityLineDetails row={row} />
          </div>
        </div>
      </div>
    </div>
  );
};
