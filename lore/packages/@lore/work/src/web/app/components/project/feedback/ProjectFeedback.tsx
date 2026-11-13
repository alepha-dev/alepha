import { Segmented, cn } from "@alepha/ui";
import {
  AutomationSubscriptionBell,
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
import {
  Circle,
  CircleCheck,
  CircleX,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";
import { currentFeedbackCountAtom } from "../../../atoms/currentFeedbackCountAtom.ts";
import { FEEDBACK_PAGE_SIZE } from "./feedbackPageSize.ts";
import ProjectFeedbackCard from "./ProjectFeedbackCard.tsx";
import ProjectFeedbackDetail from "./ProjectFeedbackDetail.tsx";
import ProjectFeedbackEmptyState from "./ProjectFeedbackEmptyState.tsx";

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
  const feedbackApi = useClient<FeedbackController>();

  const [status, setStatus] = useState<StatusFilter>("pending");
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
        <aside
          className={cn(
            "flex w-full flex-col border-r md:w-[380px] md:shrink-0",
            active && "hidden md:flex",
          )}
        >
          <div className="border-border flex items-center gap-2 border-b p-2">
            <Segmented
              value={status}
              // The address goes with it: the open item belongs to the
              // filter being left, so keeping the query would drag the
              // reader straight back to it.
              onChange={(v) => {
                address(undefined);
                showStatus(v as StatusFilter);
              }}
              options={FILTERS.map((value) => {
                const Icon = FILTER_ICONS[value];
                return {
                  value,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {/*
                        No colour of its own: the segment sets the text colour,
                        and the active one is `text-primary-foreground` over
                        the thumb. An emerald tick like the card's would be the
                        one thing on the control not reading as selected when
                        it is.
                      */}
                      <Icon className="size-3.5 shrink-0" />
                      {tr(`feedback.filter.${value}` as const)}
                    </span>
                  ),
                };
              })}
              size="lg"
              fullWidth
            />
            <AutomationSubscriptionBell
              presetKey="feedback-created"
              label={tr("feedback.subscription.label")}
              description={tr("feedback.subscription.description")}
              offDescription={tr("feedback.subscription.offDescription")}
              testId="feedback-subscription-bell"
            />
          </div>

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
                {hasMore && (
                  <button
                    type="button"
                    data-testid="feedback-show-more"
                    disabled={loadingMore}
                    onClick={() => void list.loadMore()}
                    className="text-muted-foreground hover:bg-hover hover:text-foreground border-border border-t px-3 py-3 text-sm font-medium transition-colors disabled:opacity-60"
                  >
                    {loadingMore
                      ? tr("feedback.list.loadingMore")
                      : tr("feedback.list.showMore")}
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Right detail */}
        <section
          // The COLUMN, named so a spec can measure it: the lightbox added
          // by #Q2021 has to escape it rather than fit inside it, which is
          // the whole of what feedback #P2139 asked for.
          data-testid="feedback-detail"
          className={cn("min-w-0 flex-1", !active && "hidden md:block")}
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

/*
 * Order is the triage order, which is also why "all" is gone: the inbox is a
 * queue, and a segment that mixes the three states back together answers a
 * reporting question on a screen built for acting on one item at a time.
 */
const FILTERS = ["pending", "accepted", "rejected"] as const;

/*
 * The same three glyphs `ProjectFeedbackCard.statusIcon` puts on each row and
 * `ProjectFeedbackEmptyState` puts in its tile, so the segment, the rows it
 * filters to and the pane beside them are one vocabulary rather than three.
 */
const FILTER_ICONS: Record<StatusFilter, LucideIcon> = {
  pending: Circle,
  accepted: CircleCheck,
  rejected: CircleX,
};
