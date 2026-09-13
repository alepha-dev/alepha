import * as React from "react";

void React;

import { inboxUnreadAtom } from "@alepha/ui/components/button-inbox/inbox-unread-atom.ts";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { cn } from "@alepha/ui/lib/utils";
import type { NotificationInboxController } from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export interface ButtonInboxProps {
  /**
   * Where "See all" goes. `@alepha/ui` cannot know an application's routes,
   * so the destination is the surface's to decide; the footer is hidden when
   * it is absent.
   *
   * ⚠️ It should point at the **unfiltered** list. This dropdown lists
   * messages from every scope, so a footer landing on a filtered view shows
   * fewer rows than the menu it was clicked out of.
   */
  seeAllHref?: string;
  /**
   * How many messages the dropdown lists. Five is the shape the design
   * settled on: enough to recognise what happened, short enough to read
   * without scrolling.
   */
  limit?: number;
  /**
   * Labels, for an application that localises its chrome. Each falls back to
   * its English default.
   *
   * They are this component's own props rather than entries in a shared
   * cluster's `labels` bag, because the surface that mounts the bell is the
   * one that has a translator in hand.
   */
  labels?: {
    /**
     * The trigger's `aria-label` and tooltip. Defaults to `"Notifications"`.
     */
    inbox?: string;
    heading?: string;
    empty?: string;
    markAllRead?: string;
    seeAll?: string;
  };
  variant?: "ghost" | "outline";
  /**
   * Called with the message's `href` when a row is clicked, after it has
   * been marked read. Defaults to a full navigation, which is correct for an
   * app with no router in scope and wrong for one that has it - so a router
   * app passes its own push.
   */
  onOpen?: (href: string) => void;
}

interface InboxRow {
  id: string;
  title: string;
  href: string;
  createdAt: string;
  readAt?: string;
  scopeLabel?: string;
}

/**
 * The bell: an unread count, and the most recent messages behind it.
 *
 * ## It decides for itself whether it has anything to offer
 *
 * `countInbox.can()` is the gate, and it is a **registry lookup, not a
 * request**: `/api/_links` carries only the actions the server actually
 * registered, and it prunes every `$secure()` one for an anonymous caller.
 * So this renders nothing both when the app has not registered
 * `alepha/api/notifications` and when nobody is signed in, with no 404 fired
 * on every page load. `AccountRouter` gates its five pages the same way.
 *
 * ## ⚠️ The scope chip is a label the message carries, never a parsed scope
 *
 * `scope` is an app-owned opaque string (`project:65`) and this component has
 * no way to turn one into a name - nor should it learn. The message carries
 * `scopeLabel`, written by whoever pushed it and frozen at that moment. Null
 * means no chip.
 */
export const ButtonInbox = (props: ButtonInboxProps) => {
  const api = useClient<NotificationInboxController>();
  const dt = useInject(DateTimeProvider);
  const [unread, setUnread] = useStore(inboxUnreadAtom);
  const [items, setItems] = useState<InboxRow[]>([]);

  const available = api.countInbox.can();
  const limit = props.limit ?? 5;

  const refreshCount = useCallback(async () => {
    if (!available) return;
    try {
      const result = await api.countInbox({ query: {} });
      setUnread({ count: result.unread });
    } catch {
      // A bell that throws takes the header with it. A count nobody could
      // read is zero, and the badge disappears.
      setUnread({ count: 0 });
    }
  }, [api, available]);

  useEffect(() => {
    if (!available) return;
    // A fallback, not the primary read: a host whose route loader already
    // seeded the atom has a count before the first paint, and this only
    // covers the case where that call failed or never ran.
    if (unread.count === 0) {
      void refreshCount();
    }
    // Staleness, not coverage. A message arriving while somebody sits on one
    // page is invisible until they navigate, and this is the only thing that
    // changes that.
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [available, refreshCount]);

  const load = async () => {
    if (!available) return;
    try {
      const page = await api.listInbox({ query: { limit } });
      setItems(page.items as InboxRow[]);
      setUnread({ count: page.unreadCount });
    } catch {
      setItems([]);
    }
  };

  const open = async (row: InboxRow) => {
    if (!row.readAt) {
      try {
        await api.markInboxRead({ params: { id: row.id } });
        setUnread({ count: Math.max(0, unread.count - 1) });
      } catch {
        // Opening the message matters more than recording that it was read.
      }
    }
    navigate(props, row.href);
  };

  const markAllRead = async () => {
    try {
      await api.markAllInboxRead({ query: {} });
    } finally {
      setUnread({ count: 0 });
      setItems((current) =>
        current.map((it) => ({ ...it, readAt: it.readAt ?? "read" })),
      );
    }
  };

  if (!available) {
    return null;
  }

  const label = props.labels?.inbox ?? "Notifications";
  const count = unread.count;

  return (
    <DropdownMenu onOpenChange={(next) => next && void load()}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant={props.variant ?? "ghost"}
                  size="icon"
                  aria-label={label}
                  className="relative"
                />
              }
            />
          }
        >
          <Bell className="size-4" />
          {count > 0 && (
            // Filled and in the destructive colour, not a subtle dot: the
            // whole point of the control is that an unread message is not
            // easy to miss.
            <span
              data-testid="inbox-badge"
              className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>{props.labels?.heading ?? "Notifications"}</span>
            {count > 0 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs font-normal"
                onClick={(event) => {
                  // The menu must not close: marking read is a change to what
                  // is on screen, and the reader is still reading it.
                  event.preventDefault();
                  event.stopPropagation();
                  void markAllRead();
                }}
              >
                {props.labels?.markAllRead ?? "Mark all read"}
              </button>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {items.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {props.labels?.empty ?? "Nothing new"}
            </p>
          ) : (
            items.map((row) => (
              <DropdownMenuItem
                key={row.id}
                className="flex flex-col items-start gap-0.5"
                onClick={() => void open(row)}
              >
                <span className="flex w-full items-center gap-2">
                  {!row.readAt && (
                    <span
                      data-testid="inbox-unread-dot"
                      className="bg-primary size-1.5 shrink-0 rounded-full"
                    />
                  )}
                  <span
                    className={cn(
                      "flex-1 truncate text-sm",
                      !row.readAt && "font-medium",
                    )}
                  >
                    {row.title}
                  </span>
                </span>
                <span className="text-muted-foreground flex w-full items-center gap-2 text-xs">
                  <span>{dt.of(row.createdAt).fromNow()}</span>
                  {row.scopeLabel && (
                    <span className="bg-muted ml-auto rounded px-1.5 py-0.5">
                      {row.scopeLabel}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            ))
          )}
          {props.seeAllHref && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate(props, props.seeAllHref!)}
                className="justify-center text-sm"
              >
                {props.labels?.seeAll ?? "See all"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Follow a message's destination.
 *
 * `onOpen` is what a router app passes; without one this is a full
 * navigation, which is correct for a host that has no router in scope.
 * `assign()` rather than writing `location.href`, because the href is not a
 * variable this component owns.
 */
const navigate = (props: ButtonInboxProps, href: string): void => {
  if (props.onOpen) {
    props.onOpen(href);
    return;
  }
  if (typeof window !== "undefined") {
    window.location.assign(href);
  }
};
