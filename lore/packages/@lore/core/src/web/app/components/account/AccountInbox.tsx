import { TimeAgo } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { inboxUnreadAtom } from "@alepha/ui/shell";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import { z } from "alepha";
import type { NotificationInboxController } from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useClient,
  useInfiniteQuery,
  useInject,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { CheckCheck, FolderKanban } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { DOCK_UNREAD_KEY } from "../project/useDockUnread.ts";
import LoreEmptyState from "../shared/LoreEmptyState.tsx";
import { useUserProjects } from "./useUserProjects.ts";

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
 * Every message addressed to the viewer, in the account dialog's Inbox
 * section (#Q3564).
 *
 * ## ⚠️ The account's, not a project's
 *
 * The list was a project page, `/:project/inbox`, with `?scope=` choosing
 * this project or all of them, on the reasoning that an account inbox would
 * be a second page for the same list. It was the only page of a project
 * that showed every project's messages, so it moved: a cross-project list
 * belongs to the account, and the project page went rather than becoming a
 * second copy. The header bell's "See all" opens this section, on all
 * projects, which it has to: that dropdown is cross-project, and a footer
 * showing fewer rows than the menu it came from reads as messages going
 * missing. The Project filter narrows it to one.
 *
 * ## Two different emptinesses
 *
 * "This inbox has no messages" and "your filters matched none of them" are
 * different answers. The first is good news, said by the Lore companion in
 * her `calm` mood (`LoreEmptyState`); the second stays the table's own "No
 * match". The table's `empty` node replaces both, so it is passed only while
 * no filter is set (`filtered`).
 *
 * ## The Project filter drives the server read
 *
 * Project is one of the table's own filters (#Q3779), opened from the filter
 * bar like every other table's and counted as active, but it does not filter
 * the loaded rows: the `filter` predicate ignores it, and `filters.onChange`
 * hands its value to the `useInfiniteQuery` below, whose key it is. Choosing
 * a project reads that project's messages from the server, first page, with
 * that scope's unread count and cursor, rather than narrowing whatever page
 * of all projects happened to be loaded. A project with no messages reads as
 * "no match" with a way to clear the filter, which it is.
 *
 * ## Paging is the controller's cursor
 *
 * Every page loaded so far lives in one `useInfiniteQuery` entry, flattened
 * into one array which the table sorts and searches in memory.
 * The list is append-heavy, which is exactly why the controller pages by
 * cursor rather than offset. The table pages what is loaded, and reaching its
 * last page loads the next batch (`onPage`, #Q3969): the footer's pager is
 * the one paging control.
 */
const AccountInbox = () => {
  const { tr } = useI18n<I18n, "en">();
  // Untyped on purpose: this navigates to a message's href, which the
  // server built and core's registered routers cannot name.
  const router = useRouter<any>();
  const api = useClient<NotificationInboxController>();
  const dateTime = useInject(DateTimeProvider);
  const queries = useQueryClient();

  // The Project filter's options: the projects this account belongs to.
  useUserProjects();
  const [overview] = useStore(userProjectsAtom);
  const [, setUnreadEverywhere] = useStore(inboxUnreadAtom);

  /**
   * The project the list is narrowed to, or none for all of them (the
   * default). Set by the table's Project filter through `filters.onChange`
   * (see "The Project filter drives the server read" above).
   */
  const [projectId, setProjectId] = useState<string | undefined>();
  const scope = projectId ? `project:${projectId}` : undefined;
  /**
   * Whether a search or a project narrows the list: an empty page is then
   * "No match", never the empty inbox.
   */
  const [filtered, setFiltered] = useState(false);

  /**
   * Every page read so far, one `useInfiniteQuery` keyed on the scope by the
   * controller's cursor (#E59, #Q2328, #Q3362): a scope switched while the
   * previous one loads can no longer land its rows on the new one, and a
   * scope change starts again from the first page. A failed read toasts; it
   * used to leave an empty table that read as "no messages".
   */
  const inbox = useInfiniteQuery(
    {
      key: ["inbox", scope ?? "all"],
      handler: async (_ctx, cursor: string | undefined) => {
        const page = await api.listInbox({
          query: {
            limit: PAGE_SIZE,
            ...(scope ? { scope } : {}),
            ...(cursor ? { cursor } : {}),
          },
        });
        // ⚠️ Only an all-projects read may speak for the bell, whose count
        // is cross-project. A filtered page's `unreadCount` is this
        // project's, so writing it into `inboxUnreadAtom` would understate
        // every other project's unread at once. The scoped branch used to
        // feed the rail's own badge, which went with the rail entry
        // (feedback #P2127), so it now updates nothing - the bell keeps the
        // number the loader gave it until the next navigation.
        if (!scope) {
          setUnreadEverywhere({ count: page.unreadCount });
        }
        return page;
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor,
    },
    [api, scope],
  );

  /**
   * What this screen has marked read and when, over whatever the server
   * sent. `all` is the mark-all instant, which covers rows loaded after it
   * too: the server marked the whole scope.
   */
  const [readMarks, setReadMarks] = useState<{
    ids: Record<string, string>;
    all?: string;
  }>({ ids: {} });

  const items = useMemo(
    () => inbox.pages.flatMap((page) => page.items as InboxRow[]),
    [inbox.pages],
  );
  // Memoised: the table runs in static-data mode and re-renders on the
  // array's identity.
  const rows = useMemo(
    () =>
      items.map((row) => {
        const at = row.readAt ?? readMarks.ids[row.id] ?? readMarks.all;
        return at === row.readAt ? row : { ...row, readAt: at };
      }),
    [items, readMarks],
  );
  const busy = inbox.loading || inbox.loadingMore;

  // Where the table's pager stands (#Q3969). On its last page, with more on
  // the server, the next cursor batch is fetched; run again once that batch
  // lands, in case it still fits on the same last page.
  const [paging, setPaging] = useState({ page: 0, totalPages: 0 });
  const onLastPage =
    paging.totalPages > 0 && paging.page >= paging.totalPages - 1;
  // The number of messages loaded when the last batch was asked for: one
  // request per batch, so a failed one is not retried in a loop.
  const loadedCount = items.length;
  const askedAt = useRef(-1);
  useEffect(() => {
    if (!onLastPage || !inbox.hasMore || busy) return;
    if (askedAt.current === loadedCount) return;
    askedAt.current = loadedCount;
    void inbox.loadMore();
  }, [onLastPage, inbox, busy, loadedCount]);

  /**
   * Mark one row read, optimistically. Quiet on failure (`onError`): the row
   * stays marked on screen. Re-reading it is cheap and being wrong the other
   * way costs the reader their place in the list.
   */
  const markReadAction = useAction<[row: InboxRow], void>(
    {
      handler: async (_ctx, row) => {
        setReadMarks((current) => ({
          ...current,
          ids: { ...current.ids, [row.id]: dateTime.nowISOString() },
        }));
        await api.markInboxRead({ params: { id: row.id } });
      },
      // The dock's badges count unread messages too (#Q3981).
      invalidates: [[DOCK_UNREAD_KEY]],
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
          queries.invalidate([DOCK_UNREAD_KEY]);
        } finally {
          // Same rule as the first page: zero is the whole inbox's answer
          // only when the whole inbox is what was marked.
          if (!scope) {
            setUnreadEverywhere({ count: 0 });
          }
        }
      },
    },
    [api, dateTime, scope, queries],
  );

  const unreadOnScreen = rows.filter((it) => !it.readAt).length;

  const projectItems = (overview?.projects ?? []).map((project) => ({
    value: String(project.id),
    label: project.title,
  }));

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
    // Drives the server read, not the loaded rows: the `filter` predicate
    // below ignores it.
    project: {
      schema: z.string(),
      label: tr("inbox.filter.project"),
      placeholder: tr("inbox.scope.all"),
      icon: FolderKanban,
      mode: "default",
      items: projectItems,
      hidden: projectItems.length === 0,
    },
  } satisfies DataTableFilterFields;

  return (
    <AccountPage variant="table">
      <div data-testid="inbox-table" className="flex min-h-0 flex-1 flex-col">
        <DataTable<InboxRow, typeof filterFields>
          className="min-h-0 flex-1"
          data={rows}
          defaultSort={{ field: "createdAt", direction: "desc" }}
          rowKey={(row) => row.id}
          // One paging control (#Q3969): the footer's pager. Reaching its
          // last page fetches the next cursor batch, so the pager grows a
          // page instead of a "Load more" button sitting under it.
          onPage={setPaging}
          onRowClick={(row) => void open(row)}
          actions={[
            {
              icon: CheckCheck,
              label: tr("inbox.markAllRead"),
              onClick: () => void markAllAction.run(),
              disabled: unreadOnScreen === 0 || markAllAction.loading,
            },
          ]}
          empty={
            filtered ? undefined : (
              <LoreEmptyState
                mood="calm"
                title={tr("inbox.empty")}
                description={tr("inbox.empty.description")}
              />
            )
          }
          noMatchState={{
            title: tr("inbox.noMatch"),
            description: tr("inbox.noMatch.description"),
          }}
          filters={{
            fields: filterFields,
            onChange: (values) => {
              setProjectId(values.project ? String(values.project) : undefined);
              setFiltered(!!values.project || !!values.search?.trim());
            },
          }}
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
                      className={
                        row.readAt ? "truncate" : "truncate font-medium"
                      }
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
      </div>
    </AccountPage>
  );
};

export default AccountInbox;
