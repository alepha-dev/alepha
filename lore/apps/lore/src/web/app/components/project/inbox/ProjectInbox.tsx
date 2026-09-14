import { TimeAgo, Button } from "@alepha/ui";
import { inboxUnreadAtom } from "@alepha/ui/shell";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import type { NotificationInboxController } from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useClient,
  useInject,
  useQuery,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { CheckCheck, FolderOpen, Globe } from "lucide-react";
import { useMemo, useState } from "react";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

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
 * One empty list, so a scope with no appended pages keeps the rows' identity
 * across renders.
 */
const NO_ROWS: InboxRow[] = [];

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
  const [, setUnreadEverywhere] = useStore(inboxUnreadAtom);

  // `all` shows every project; anything else means this one. Read from the
  // URL rather than from state, because two entry points want two defaults.
  const allProjects = router.query.scope === "all";
  const scope = !allProjects && project ? `project:${project.id}` : undefined;

  /**
   * The first page, a `useQuery` keyed on the scope (#E59, #Q2328): a scope
   * switched while the previous one loads can no longer land its rows on the
   * new one. A failed read toasts; it used to leave an empty table that read
   * as "no messages".
   */
  const firstPage = useQuery(
    {
      key: ["inbox", scope ?? "all"],
      handler: () =>
        api.listInbox({
          query: { limit: PAGE_SIZE, ...(scope ? { scope } : {}) },
        }),
      onSuccess: (page) => {
        // ⚠️ Only the all-projects read may speak for the bell, whose count
        // is cross-project. A filtered page's `unreadCount` is this
        // project's, so writing it into `inboxUnreadAtom` would understate
        // every other project's unread at once. The scoped branch used to
        // feed the rail's own badge, which went with the rail entry
        // (feedback #P2127), so it now updates nothing - the bell keeps the
        // number the loader gave it until the next navigation, which is
        // exactly what it did before on this page.
        if (!scope) {
          setUnreadEverywhere({ count: page.unreadCount });
        }
      },
    },
    [api, scope],
  );

  /**
   * The pages "Load more" appended, for the scope they were read in. A scope
   * change leaves them behind rather than clearing them in an effect: rows
   * from another scope simply stop matching.
   */
  const [more, setMore] = useState<{
    scope?: string;
    items: InboxRow[];
    cursor?: string;
  }>({ items: [] });
  const extra = more.scope === scope ? more.items : NO_ROWS;

  /**
   * What this screen has marked read and when, over whatever the server
   * sent. `all` is the mark-all instant, which covers rows loaded after it
   * too: the server marked the whole scope.
   */
  const [readMarks, setReadMarks] = useState<{
    ids: Record<string, string>;
    all?: string;
  }>({ ids: {} });

  const firstItems = firstPage.data?.items as InboxRow[] | undefined;
  // Memoised: the table runs in static-data mode and re-renders on the
  // array's identity.
  const rows = useMemo(
    () =>
      [...(firstItems ?? []), ...extra].map((row) => {
        const at = row.readAt ?? readMarks.ids[row.id] ?? readMarks.all;
        return at === row.readAt ? row : { ...row, readAt: at };
      }),
    [firstItems, extra, readMarks],
  );
  const cursor = extra.length > 0 ? more.cursor : firstPage.data?.nextCursor;

  const loadMoreAction = useAction<[after: string], void>(
    {
      handler: async (after) => {
        const page = await api.listInbox({
          query: {
            limit: PAGE_SIZE,
            ...(scope ? { scope } : {}),
            cursor: after,
          },
        });
        setMore((current) => ({
          scope,
          items: [
            ...(current.scope === scope ? current.items : []),
            ...(page.items as InboxRow[]),
          ],
          cursor: page.nextCursor,
        }));
        if (!scope) {
          setUnreadEverywhere({ count: page.unreadCount });
        }
      },
    },
    [api, scope],
  );
  const busy = firstPage.loading || loadMoreAction.loading;

  /**
   * Mark one row read, optimistically. Quiet on failure (`onError`): the row
   * stays marked on screen. Re-reading it is cheap and being wrong the other
   * way costs the reader their place in the list.
   */
  const markReadAction = useAction<[row: InboxRow], void>(
    {
      handler: async (row) => {
        setReadMarks((current) => ({
          ...current,
          ids: { ...current.ids, [row.id]: dateTime.nowISOString() },
        }));
        await api.markInboxRead({ params: { id: row.id } });
      },
      onError: () => {},
    },
    [api, dateTime],
  );

  const open = async (row: InboxRow) => {
    if (!row.readAt) {
      // Awaited but not trusted: the navigation happens whether or not the
      // mark landed, which is the point of marking it quietly.
      await markReadAction.run(row);
    }
    void router.push(row.href);
  };

  const markAllAction = useAction<[], void>(
    {
      handler: async () => {
        setReadMarks((current) => ({
          ...current,
          all: dateTime.nowISOString(),
        }));
        try {
          await api.markAllInboxRead({ query: scope ? { scope } : {} });
        } finally {
          // Same rule as the first page: zero is the whole inbox's answer
          // only when the whole inbox is what was marked.
          if (!scope) {
            setUnreadEverywhere({ count: 0 });
          }
        }
      },
    },
    [api, dateTime, scope],
  );

  const setScope = (next: "project" | "all") => {
    if (!project?.slug) return;
    void router.push("projectInbox", {
      params: { projectSlug: project.slug },
      query: next === "all" ? { scope: "all" } : {},
    });
  };

  const unreadOnScreen = rows.filter((it) => !it.readAt).length;

  const filterFields = {
    // Spans the title and the body preview, so it is not a field the table
    // can match by name: the `filter` predicate does it.
    search: {
      preset: "search",
      control: {
        // ⚠️ The kit's plain "Search" is the placeholder, like every filter
        // bar (#Q1750), and that is thin for a screen reader on a page
        // carrying several controls - so the accessible name keeps the
        // fuller phrase.
        inputProps: { "aria-label": tr("inbox.filter.searchLabel") },
      },
    },
  } satisfies DataTableFilterFields;

  return (
    <div
      data-testid="inbox-table"
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-2"
    >
      <DataTable<InboxRow, typeof filterFields>
        className="min-h-0 flex-1"
        data={rows}
        defaultSort={{ field: "createdAt", direction: "desc" }}
        rowKey={(row) => row.id}
        onRowClick={(row) => void open(row)}
        actions={[
          {
            icon: CheckCheck,
            label: tr("inbox.markAllRead"),
            onClick: () => void markAllAction.run(),
            disabled: unreadOnScreen === 0 || markAllAction.loading,
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
          title: tr("inbox.empty"),
          description: tr("inbox.empty.description"),
        }}
        noMatchState={{
          title: tr("inbox.noMatch"),
          description: tr("inbox.noMatch.description"),
        }}
        filters={{ fields: filterFields }}
        filter={(row, values) => {
          const search = (values.search ?? "").toLowerCase();
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
            // The same pair the Quests and Releases tables use, and it needs
            // both halves: the table is auto-layout, so `max-width: 0` is
            // what stops this column claiming its content width and
            // `width: 100%` is what makes it absorb whatever the others
            // leave. Without the pair the column grows to fit the longest
            // message and the ellipsis never fires.
            //
            // `min-w-48` is the floor. Once the other columns' intrinsic
            // widths fill the container there is nothing for `width: 100%`
            // to claim and `max-width: 0` collapses this to literally zero;
            // min-width wins over max-width, so it stops there and the
            // table's own `overflow-x-auto` takes over.
            className: "w-full max-w-0 min-w-48",
            cell: (row) => (
              <span className="flex min-w-0 items-center gap-2">
                {!row.readAt && (
                  <span
                    data-testid="inbox-row-unread"
                    className="bg-primary size-1.5 shrink-0 rounded-full"
                    aria-label={tr("inbox.unread")}
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
              <TimeAgo
                value={row.createdAt}
                className="text-muted-foreground text-xs"
              />
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
            onClick={() => void loadMoreAction.run(cursor)}
          >
            {tr("inbox.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ProjectInbox;
