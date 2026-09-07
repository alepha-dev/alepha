import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { inboxUnreadAtom } from "@alepha/ui/components/button-inbox/inbox-unread-atom.ts";
import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import type { NotificationInboxController } from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { CheckCheck, FolderOpen, Globe, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInboxCountAtom } from "../../../atoms/currentInboxCountAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import FilterSlot from "../../shared/FilterSlot.tsx";

const filtersSchema = z.object({
  /**
   * Spans the title and the body preview, so it is not a field the table can
   * match by name.
   */
  search: z.string().optional(),
});

interface InboxRow {
  id: string;
  title: string;
  body?: string;
  href: string;
  createdAt: string;
  readAt?: string;
  scope?: string;
  scopeLabel?: string;
}

const PAGE_SIZE = 25;

/**
 * Every message addressed to the viewer.
 *
 * ## ⚠️ One route, two entry points, one query param
 *
 * There is deliberately no `/account/inbox`: it would be a second page for
 * the same list differing only in a default filter. The scope is `?scope=`
 * instead, so the sidebar entry lands on this project and the header bell's
 * "See all" lands on all projects - which it has to, because that dropdown is
 * cross-project and a footer showing fewer rows than the menu it came from
 * reads as messages going missing.
 *
 * ## Two different emptinesses
 *
 * "This scope has no messages" and "your search matched none of them" are
 * different answers and the table already distinguishes them by
 * `activeFilterCount`. The scope is NOT one of the table's filters: it drives
 * the server fetch, so folding it in would have the table re-filtering in
 * memory rows the server already narrowed, and "no match" would then be shown
 * for a scope that is simply empty.
 *
 * ## Paging is the controller's cursor
 *
 * Accumulated into one array which the table sorts and searches in memory.
 * The list is append-heavy, which is exactly why the controller pages by
 * cursor rather than offset, and why "Load more" adds to what is on screen
 * instead of replacing it.
 */
const ProjectInbox = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const api = useClient<NotificationInboxController>();
  const dateTime = useInject(DateTimeProvider);

  const [project] = useStore(currentProjectAtom);
  const [, setProjectCount] = useStore(currentInboxCountAtom);
  const [, setUnreadEverywhere] = useStore(inboxUnreadAtom);

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // `all` shows every project; anything else means this one. Read from the
  // URL rather than from state, because two entry points want two defaults.
  const allProjects = router.query.scope === "all";
  const scope = !allProjects && project ? `project:${project.id}` : undefined;

  const fetchPage = useCallback(
    async (after?: string) => {
      setBusy(true);
      try {
        const page = await api.listInbox({
          query: {
            limit: PAGE_SIZE,
            ...(scope ? { scope } : {}),
            ...(after ? { cursor: after } : {}),
          },
        });
        setRows((current) =>
          after
            ? [...current, ...(page.items as InboxRow[])]
            : (page.items as InboxRow[]),
        );
        setCursor(page.nextCursor);
        // The counts on screen come from the same read, so the rail and the
        // page cannot disagree while somebody is looking at both.
        if (scope) {
          setProjectCount({ count: page.unreadCount });
        } else {
          setUnreadEverywhere({ count: page.unreadCount });
        }
      } catch {
        // A list that could not be read is empty, not an error boundary: the
        // rest of the project shell is still usable.
        if (!after) setRows([]);
        setCursor(undefined);
      } finally {
        setBusy(false);
      }
    },
    [api, scope],
  );

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because `fetchPage` flips
    // `busy` before its first await. Same shape, and the same suppression, as
    // `FeedbackThread`'s own load.
    // oxlint-disable-next-line react/set-state-in-effect
    void fetchPage();
  }, [fetchPage]);

  const open = async (row: InboxRow) => {
    if (!row.readAt) {
      await markRead(row);
    }
    void router.push(row.href);
  };

  const markRead = async (row: InboxRow) => {
    setRows((current) =>
      current.map((it) =>
        it.id === row.id ? { ...it, readAt: dateTime.nowISOString() } : it,
      ),
    );
    try {
      await api.markInboxRead({ params: { id: row.id } });
    } catch {
      // The row stays marked on screen. Re-reading it is cheap and being
      // wrong the other way costs the reader their place in the list.
    }
  };

  const markAllRead = async () => {
    const at = dateTime.nowISOString();
    setRows((current) =>
      current.map((it) => ({ ...it, readAt: it.readAt ?? at })),
    );
    try {
      await api.markAllInboxRead({ query: scope ? { scope } : {} });
    } finally {
      if (scope) {
        setProjectCount({ count: 0 });
      } else {
        setUnreadEverywhere({ count: 0 });
      }
    }
  };

  const setScope = (next: "project" | "all") => {
    if (!project?.slug) return;
    void router.push("projectInbox", {
      params: { projectSlug: project.slug },
      query: next === "all" ? { scope: "all" } : {},
    });
  };

  const unreadOnScreen = rows.filter((it) => !it.readAt).length;

  return (
    <div
      data-testid="inbox-table"
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-4"
    >
      <AlephaTable<InboxRow>
        className="min-h-0 flex-1"
        data={rows}
        defaultSort={{ field: "createdAt", direction: "desc" }}
        rowKey={(row) => row.id}
        onRowClick={(row) => void open(row)}
        actions={[
          {
            icon: CheckCheck,
            label: String(tr("inbox.markAllRead")),
            onClick: () => void markAllRead(),
            disabled: unreadOnScreen === 0,
          },
          {
            // A toggle rather than two entries: there are exactly two scopes
            // and the label says which one the click leads to.
            icon: allProjects ? FolderOpen : Globe,
            label: String(
              allProjects ? tr("inbox.scope.project") : tr("inbox.scope.all"),
            ),
            onClick: () => setScope(allProjects ? "project" : "all"),
          },
        ]}
        emptyState={{
          title: String(tr("inbox.empty")),
          description: String(tr("inbox.empty.description")),
        }}
        noMatchState={{
          title: String(tr("inbox.noMatch")),
          description: String(tr("inbox.noMatch.description")),
        }}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <FilterSlot>
              <Control
                input={form.input.search}
                label=""
                icon={Search}
                placeholder={tr("inbox.filter.search")}
                inputProps={{ "aria-label": tr("inbox.filter.search") }}
              />
            </FilterSlot>
          ),
        }}
        filter={(row, values) => {
          const search = String(values.search ?? "").toLowerCase();
          if (!search) return true;
          return (
            row.title.toLowerCase().includes(search) ||
            (row.body ?? "").toLowerCase().includes(search)
          );
        }}
        columns={{
          title: {
            label: tr("inbox.table.message"),
            sortable: true,
            cell: (row) => (
              <span className="flex min-w-0 items-center gap-2">
                {!row.readAt && (
                  <span
                    data-testid="inbox-row-unread"
                    className="bg-primary size-1.5 shrink-0 rounded-full"
                    aria-label={String(tr("inbox.unread"))}
                  />
                )}
                <span className="flex min-w-0 flex-col">
                  {/* Read and unread differ by weight AND by the dot above:
                      a weight change alone is not a difference somebody
                      scanning a list will see. */}
                  <span
                    className={row.readAt ? "truncate" : "truncate font-medium"}
                  >
                    {row.title}
                  </span>
                  {row.body && (
                    <span className="text-muted-foreground truncate text-xs">
                      {row.body}
                    </span>
                  )}
                </span>
              </span>
            ),
          },
          scopeLabel: {
            label: tr("inbox.table.project"),
            sortable: true,
            // The label the message carries. `scope` is opaque and is never
            // parsed here either.
            cell: (row) => (
              <span className="text-muted-foreground text-xs">
                {row.scopeLabel ?? ""}
              </span>
            ),
          },
          createdAt: {
            label: tr("inbox.table.when"),
            sortable: true,
            cell: (row) => (
              <span className="text-muted-foreground text-xs">
                {dateTime.of(row.createdAt).fromNow()}
              </span>
            ),
          },
        }}
      />

      {cursor && (
        <div className="flex justify-center pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void fetchPage(cursor)}
          >
            {tr("inbox.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ProjectInbox;
