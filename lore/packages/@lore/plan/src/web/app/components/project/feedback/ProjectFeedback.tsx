import { cn, PaneResizer } from "@alepha/ui";
import {
  PinnedPromptsButton,
  SubscriptionBell,
  currentProjectAtom,
  type I18n,
} from "@lore/core/web";
import {
  useClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { Inbox, ShieldAlert } from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";
import { currentFeedbackCountAtom } from "../../../atoms/currentFeedbackCountAtom.ts";
import { feedbackListWidthAtom } from "../../../atoms/feedbackListWidthAtom.ts";
import { FEEDBACK_PAGE_SIZE } from "./feedbackPageSize.ts";
import ProjectFeedbackCard from "./ProjectFeedbackCard.tsx";
import ProjectFeedbackDetail from "./ProjectFeedbackDetail.tsx";
import ProjectFeedbackEmptyState from "./ProjectFeedbackEmptyState.tsx";
import ProjectFeedbackStatusSelect from "./ProjectFeedbackStatusSelect.tsx";

/*
 * Exactly the entity's own three states, and deliberately derived rather than
 * retyped: a fourth "all" segment used to sit alongside them. "all" is still a
 * value the endpoint accepts (`listFeedback`'s enum, and the account Feedback section
 * still asks for it), so this is about what the inbox offers, not about what
 * the API can answer.
 */
type StatusFilter = FeedbackResource["status"];

export interface ProjectFeedbackProps {
  items: FeedbackResource[];
  hasMore: boolean;
}

const ProjectFeedback = (props: ProjectFeedbackProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const [, setFeedbackCount] = useStore(currentFeedbackCountAtom);
  // The list's width (#Q4325): the atom's, and the drag's while one runs, so
  // a drag repaints without writing the cookie on every pointer move.
  const [listWidth, setListWidth] = useStore(feedbackListWidthAtom);
  const [dragWidth, setDragWidth] = useState<number | undefined>();
  const width = dragWidth ?? listWidth.width ?? LIST_DEFAULT_WIDTH;
  const feedbackApi = useClient<FeedbackController>();

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [awaitingTrust, setAwaitingTrust] = useState(0);
  const queries = useQueryClient();
  /**
   * The card the reader opened. `undefined` follows the list: the first row,
   * and again the first row whenever the list no longer holds the one that
   * was open (a status switch, a triage). `null` is "none": Back closes the
   * pane, and it stays closed until a card is clicked or the status changes.
   *
   * Derived at render rather than written after each load: the load handler
   * used to pick it, and an effect doing so would fight the URL (#156).
   */
  const [activeId, setActiveId] = useState<number | null | undefined>(
    undefined,
  );

  /**
   * The item the URL names, by the `#P` number a reader knows.
   *
   * `?feedback=<shortId>` rather than a path segment, because it is already
   * the address of a feedback item everywhere else in Lore: it is what
   * `createWikiLinkResolver` emits for `[[#P120]]` and what
   * `WikiLinkHoverProvider` matches to draw the hover card. Those links have
   * pointed here since typed references landed and the inbox ignored the
   * query, so every one of them opened the inbox on whatever happened to be
   * first. Honouring it fixes them and the quest badge at once.
   *
   * A path child (`/feedback/:number`) was the other shape, and it costs
   * more than it gives: the detail would have to become a nested view, and
   * the master-detail list beside it remounts every time that swaps - which
   * is exactly the trap `FoliosLayout` documents and paid for twice.
   */
  const addressed = Number(routerState.query?.feedback);
  const hasAddress = Number.isInteger(addressed) && addressed > 0;

  /**
   * The badge counts the whole pending set, never the page.
   *
   * It used to be `items.length` off the list, which was the same number
   * while the list was unbounded. With a ten-row page it would report 10
   * over an inbox of 106 — a badge that reads as a full inbox emptying
   * itself down to a round number.
   *
   * A keyed query (#E59, #Q2328) that a triage invalidates. Quiet: the badge
   * is chrome, and a failed count must not toast over the inbox.
   */
  useQuery(
    {
      key: ["feedback-count", project?.id],
      enabled: !!project,
      handler: () =>
        feedbackApi.countFeedback({
          params: { projectId: project?.id as number },
          query: { status: "pending" },
        }),
      onSuccess: (r) => {
        setFeedbackCount({ count: r.count });
        setAwaitingTrust(r.awaitingTrust);
      },
      onError: () => {},
    },
    [feedbackApi, project?.id],
  );

  /**
   * The list for one status, every page loaded so far, one
   * `useInfiniteQuery` keyed by project and status (#Q3362).
   *
   * - **A status switch is a key change**, which supersedes a status still
   *   loading, so a slow `pending` can no longer land over `accepted`.
   *   `keepPreviousData` keeps the rows of the status being left on screen
   *   until the new ones arrive: no loading indicator on purpose, the switch
   *   refetches in ~300ms and a spinner next to the segmented control reads
   *   as flicker (feedback #11).
   * - **The route loader's first `pending` page seeds the entry**
   *   (`initialData`), so mounting sends no list request; `staleTime` covers
   *   that handoff, and a status picked again within it renders from cache.
   * - **The offset is the number of rows loaded so far**, not a page counter:
   *   the list is filtered by status, so a row triaged between two presses
   *   shifts the window instead of leaving a gap. Rows are deduped by id
   *   below, since the window can then overlap.
   * - **A triage invalidates the list**, and the hook reloads the pages it
   *   had, in order: a list scrolled to its third page keeps its depth
   *   instead of falling back to the first ten rows.
   */
  const list = useInfiniteQuery(
    {
      key: ["feedback-list", project?.id, status],
      enabled: !!project,
      initialData: props.items
        ? {
            pages: [{ items: props.items, hasMore: props.hasMore ?? false }],
            pageParams: [0],
          }
        : undefined,
      staleTime: [30, "seconds"],
      // Back on the tab, the inbox reads again (#Q4069), once the 30 s
      // staleTime has run out.
      refetchOnFocus: true,
      keepPreviousData: true,
      handler: (_ctx, offset: number) =>
        feedbackApi.listFeedback({
          params: { projectId: project?.id as number },
          query: {
            status,
            limit: FEEDBACK_PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          },
        }),
      initialPageParam: 0,
      getNextPageParam: (last, pages) =>
        last.hasMore
          ? pages.reduce((count, page) => count + page.items.length, 0)
          : undefined,
    },
    [feedbackApi, project?.id, status],
  );

  // Keyed by id: the offset above can overlap when the set shifted under it,
  // and a duplicate row would break React's keys as well as the eye.
  const items = useMemo(() => {
    const seen = new Set<number>();
    const rows: FeedbackResource[] = [];
    for (const page of list.pages) {
      for (const item of page.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          rows.push(item);
        }
      }
    }
    return rows;
  }, [list.pages]);
  const hasMore = list.hasMore;
  const loadingMore = list.loadingMore;

  // The end of the list, watched: in view with more on the server, the next
  // page loads (#Q3969). Asked once per page loaded, so a failed read is not
  // retried in a loop.
  const moreRef = useRef<HTMLDivElement | null>(null);
  const askedAt = useRef(-1);
  const loadedCount = items.length;
  useEffect(() => {
    const node = moreRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((it) => it.isIntersecting)) return;
      if (list.loadingMore || askedAt.current === loadedCount) return;
      askedAt.current = loadedCount;
      void list.loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, list, loadedCount]);

  /**
   * Show another status. A closed pane opens again on the new list's first
   * row; an open card stays open when the new list holds it, which is what
   * an addressed item switching the filter to its own status needs.
   */
  const showStatus = (next: StatusFilter) => {
    setActiveId((current) => (current === null ? undefined : current));
    setStatus(next);
  };

  /**
   * The addressed item when it is NOT in the list beside it, which is the
   * case the address exists for: a promoted item is `accepted` and the inbox
   * opens on `pending`, so a link from a quest names something this page has
   * not loaded and would not load on its own.
   *
   * It is a handoff, not a second source of truth. On arrival the filter
   * switches to the item's own status, the list reloads carrying it, and the
   * derivation below prefers the listed row from then on. Asked only while
   * the list cannot answer for it, so clicking through the inbox is free
   * beyond the URL it writes.
   *
   * Quiet on failure: a number that names nothing this reader can open (a
   * deleted item, a typo, an inbox their rank does not reach) leaves the
   * page on whatever it had rather than growing an error state for a URL
   * nobody typed on purpose.
   */
  const addressedQuery = useQuery(
    {
      key: ["feedback", project?.id, { shortId: addressed }],
      enabled:
        hasAddress &&
        !!project &&
        !items.some((item) => item.shortId === addressed),
      handler: () =>
        feedbackApi.getFeedbackByShortId({
          params: { projectId: project?.id as number, shortId: addressed },
        }),
      onSuccess: (row) => {
        // The filter follows the item, so the list beside it holds the row
        // the reader came for and highlights it. Without this a link to an
        // accepted item opens a detail pane whose row is nowhere on screen.
        if (row.status !== status) {
          showStatus(row.status);
        }
      },
      onError: () => {},
    },
    [feedbackApi, project?.id, addressed, hasAddress],
  );
  const addressedItem = addressedQuery.error ? undefined : addressedQuery.data;

  /**
   * The open item: what the URL names if it names anything, else what was
   * last clicked or auto-selected.
   *
   * The address wins over `activeId` while it is set, which is what makes a
   * link authoritative, and it means the fetched item needs no place in
   * `activeId` at all - a stale `addressedItem` from an address that has
   * since changed simply stops matching.
   */
  const addressedActive = hasAddress
    ? (items.find((p) => p.shortId === addressed) ??
      (addressedItem?.shortId === addressed ? addressedItem : undefined))
    : undefined;
  const active =
    addressedActive ??
    (activeId === null
      ? null
      : (items.find((p) => p.id === activeId) ?? items[0] ?? null));

  /**
   * Write the selection into the URL, so the pane can be linked to, and comes
   * back on a refresh. `undefined` clears it, which is what Back and every
   * triage action want: the item they were showing has left this list.
   */
  const address = (shortId?: number) => {
    if (!project) return;
    void router.push("projectFeedback", {
      params: { projectSlug: project.slug },
      query: shortId != null ? { feedback: String(shortId) } : undefined,
    });
  };

  const onChanged = () => {
    address(undefined);
    queries.invalidate(["feedback-count", project?.id]);
    queries.invalidate(["feedback-list", project?.id]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* List + detail split */}
      <div className="flex min-h-0 flex-1">
        {/* Left list */}
        {/* From `md` up the width is the variable's, and the handle draws
            the right border; below, the list is the whole page. */}
        <aside
          data-testid="feedback-list-pane"
          className={cn(
            "chrome relative flex w-full flex-col border-r md:w-(--feedback-list-width) md:shrink-0 md:border-r-0",
            active && "hidden md:flex",
          )}
          style={{ "--feedback-list-width": `${width}px` } as CSSProperties}
        >
          {/* `h-14`, the detail header's own height, so the two bands line up. */}
          <div className="border-border chrome flex h-14 shrink-0 items-center gap-2 border-b px-2">
            <ProjectFeedbackStatusSelect
              key={status}
              value={status}
              // The address goes with it: the open item belongs to the
              // filter being left, so keeping the query would drag the
              // reader straight back to it.
              onChange={(next) => {
                address(undefined);
                showStatus(next);
              }}
            />
            <div className="ms-auto shrink-0" />
            {/* The prompts pinned on the Feedback list (#Q4284). The open
                item's panel has its own button, which tells the spotlight
                the item; this one does not. */}
            <PinnedPromptsButton page="feedback" publish={false} />
            <SubscriptionBell
              events={["feedback.created"]}
              label={tr("feedback.subscription.label")}
              description={tr("feedback.subscription.description")}
              offDescription={tr("feedback.subscription.offDescription")}
              // Opens a dialog: channels, and whose feedback (#Q4055, #Q4290).
              authors={{
                allLabel: tr("feedback.subscription.all"),
                notMineLabel: tr("feedback.subscription.notMine"),
                notMembersLabel: tr("feedback.subscription.notMembers"),
              }}
              testId="feedback-subscription-bell"
            />
          </div>

          {/* Untrusted items no member trusted yet (#Q4216): no agent
              reads them, so the inbox says they wait for a person. */}
          {status === "pending" && awaitingTrust > 0 && (
            <p
              className="border-border text-muted-foreground flex items-center gap-2 border-b px-3 py-2 text-xs"
              data-testid="feedback-awaiting-trust"
            >
              <ShieldAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              {tr("feedback.awaitingTrust", {
                args: [String(awaitingTrust)],
              })}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
                <Inbox className="size-8 opacity-60" />
                <p className="text-sm">
                  {status === "pending"
                    ? tr("feedback.empty.pending")
                    : tr("feedback.empty.status", {
                        args: [tr(`feedback.filter.${status}` as const)],
                      })}
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {items.map((feedback) => (
                  <ProjectFeedbackCard
                    key={feedback.id}
                    feedback={feedback}
                    selected={feedback.id === active?.id}
                    onClick={() => {
                      setActiveId(feedback.id);
                      address(feedback.shortId);
                    }}
                  />
                ))}
                {/* No button (#Q3969): the list scrolls, and its end coming
                    into view loads the next page. */}
                {hasMore && (
                  <div
                    ref={moreRef}
                    data-testid="feedback-more-sentinel"
                    className="text-muted-foreground px-3 py-3 text-center text-sm"
                  >
                    {loadingMore ? tr("feedback.list.loadingMore") : null}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="hidden md:block">
            <PaneResizer
              width={listWidth.width ?? LIST_DEFAULT_WIDTH}
              minWidth={LIST_MIN_WIDTH}
              maxWidth={LIST_MAX_WIDTH}
              defaultWidth={LIST_DEFAULT_WIDTH}
              onResize={setDragWidth}
              onWidth={(next) => {
                setDragWidth(undefined);
                setListWidth({ width: next });
              }}
            />
          </div>
        </aside>

        {/* Right detail */}
        <section
          // The COLUMN, named so a spec can measure it: the lightbox added
          // by #Q2021 has to escape it rather than fit inside it, which is
          // the whole of what feedback #P2139 asked for.
          data-testid="feedback-detail"
          className={cn(
            // Content: the card surface, as the rules in `@alepha/ui`'s
            // `styles.css` have it, never the page's own background.
            "bg-card min-w-0 flex-1",
            !active && "hidden md:block",
          )}
        >
          {active ? (
            <ProjectFeedbackDetail
              feedback={active}
              onChanged={onChanged}
              onBack={() => {
                setActiveId(null);
                address(undefined);
              }}
            />
          ) : (
            <ProjectFeedbackEmptyState
              status={status}
              hasItems={items.length > 0}
            />
          )}
        </section>
      </div>
    </div>
  );
};

export default ProjectFeedback;

/**
 * The list pane's width bounds and default, in pixels (#Q4325). Below 320
 * the band's status select, pinned prompts and bell no longer fit on one
 * line; past 640 the list takes more than the item it opens.
 */
const LIST_MIN_WIDTH = 320;
const LIST_MAX_WIDTH = 640;
const LIST_DEFAULT_WIDTH = 380;
