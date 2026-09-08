import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  Circle,
  CircleCheck,
  CircleX,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentFeedbackCountAtom } from "../../../atoms/currentFeedbackCountAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { FEEDBACK_PAGE_SIZE } from "./feedbackPageSize.ts";
import ProjectFeedbackCard from "./ProjectFeedbackCard.tsx";
import ProjectFeedbackDetail from "./ProjectFeedbackDetail.tsx";
import ProjectFeedbackEmptyState from "./ProjectFeedbackEmptyState.tsx";

/*
 * Exactly the entity's own three states, and deliberately derived rather than
 * retyped: a fourth "all" segment used to sit alongside them. "all" is still a
 * value the endpoint accepts (`listFeedback`'s enum, and `/account/feedback`
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
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const [, setFeedbackCount] = useStore(currentFeedbackCountAtom);
  const feedbackApi = useClient<FeedbackController>();

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<FeedbackResource[]>(props.items ?? []);
  const [hasMore, setHasMore] = useState(props.hasMore ?? false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(
    props.items?.[0]?.id ?? null,
  );

  /**
   * The item the URL names, by the `#P` number a reader knows.
   *
   * `?feedback=<shortId>` rather than a path segment, because it is already
   * the address of a feedback item everywhere else in Lore: it is what
   * `createFolioWikiLinkResolver` emits for `[[#P120]]` and what
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
   * The addressed item when it is NOT in the list beside it, which is the
   * case the address exists for: a promoted item is `accepted` and the inbox
   * opens on `pending`, so a link from a quest names something this page has
   * not loaded and would not load on its own.
   *
   * It is a handoff, not a second source of truth. The effect below switches
   * the filter to the item's own status, the list reloads carrying it, and
   * the derivation below prefers the listed row from then on. Nothing clears
   * this: a value left over from an address that has changed simply stops
   * matching.
   */
  const [addressedItem, setAddressedItem] = useState<
    FeedbackResource | undefined
  >(undefined);

  /**
   * The badge counts the whole pending set, never the page.
   *
   * It used to be `items.length` off the list, which was the same number
   * while the list was unbounded. With a ten-row page it would report 10
   * over an inbox of 106 — a badge that reads as a full inbox emptying
   * itself down to a round number.
   */
  const refreshCount = () => {
    if (!project) return;
    feedbackApi
      .countFeedback({
        params: { projectId: project.id },
        query: { status: "pending" },
      })
      .then((r) => setFeedbackCount({ count: r.count }))
      .catch(() => {});
  };

  // No loading indicator on purpose: the status switch refetches in ~300ms and
  // a spinner next to the segmented control reads as flicker (feedback #11).
  const reload = async (next: StatusFilter = status) => {
    if (!project) return;
    const res = await feedbackApi.listFeedback({
      params: { projectId: project.id },
      query: { status: next, limit: FEEDBACK_PAGE_SIZE },
    });
    setItems(res.items);
    setHasMore(res.hasMore);
    // Keep the open item when the reloaded list still holds it, and fall back
    // to the first row when it does not.
    //
    // It used to select the first row unconditionally, which was the same
    // thing while every reload was a status switch or a triage action - both
    // move the item OUT of the list being loaded. An addressed item is the
    // case that broke it: opening `?feedback=120` on an accepted item
    // switches the filter to `accepted`, and this reload would have thrown
    // the selection away the moment the list carrying it arrived.
    setActiveId((current) =>
      current != null && res.items.some((item) => item.id === current)
        ? current
        : (res.items[0]?.id ?? null),
    );
    refreshCount();
  };

  /**
   * Append the next page. Deliberately not a `reload`: the selected card and
   * the pages already on screen both survive, so pressing this never moves
   * the detail pane out from under whoever is reading it.
   *
   * The offset is `items.length` rather than a page counter, so a row
   * accepted or rejected between two presses shifts the window instead of
   * leaving a gap — the list is filtered by status, and a triaged row leaves
   * it.
   */
  const loadMore = async () => {
    if (!project || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await feedbackApi.listFeedback({
        params: { projectId: project.id },
        query: {
          status,
          limit: FEEDBACK_PAGE_SIZE,
          offset: items.length,
        },
      });
      // Keyed by id: the offset above can overlap when the set shifted under
      // it, and a duplicate row would break React's keys as well as the eye.
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...res.items.filter((item) => !seen.has(item.id))];
      });
      setHasMore(res.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (status === "pending" && props.items && items === props.items) {
      refreshCount();
      return;
    }
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because the loader flips
    // `loading` before its first await.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload(status);
  }, [status]);

  /**
   * Fetch the addressed item, and only when the list cannot answer for it.
   *
   * Runs on `items` too, not only on the number: the list arriving is what
   * completes the handoff. A number already in the list costs nothing, so
   * clicking through the inbox is free beyond the URL it writes.
   *
   * ⚠️ Nothing here sets state synchronously, deliberately. Which item is
   * open is DERIVED below rather than pushed into `activeId` from here: an
   * effect that selects on sight is a second writer of the selection, racing
   * the reload it triggers. Only the fetch's own continuation writes, which
   * is the "synchronize with an external system" case.
   */
  useEffect(() => {
    if (!hasAddress || !project) return;
    if (items.some((item) => item.shortId === addressed)) return;
    let cancelled = false;
    void feedbackApi
      .getFeedbackByShortId({
        params: { projectId: project.id, shortId: addressed },
      })
      .then((row) => {
        if (cancelled) return;
        setAddressedItem(row);
        // The filter follows the item, so the list beside it holds the row
        // the reader came for and highlights it. Without this a link to an
        // accepted item opens a detail pane whose row is nowhere on screen.
        if (row.status !== status) {
          setStatus(row.status);
        }
      })
      .catch(() => {
        // A number that names nothing this reader can open: a deleted item,
        // a typo, or an inbox their rank does not reach. The page stays on
        // whatever it had rather than growing an error state for a URL
        // nobody typed on purpose.
        if (!cancelled) setAddressedItem(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [addressed, hasAddress, items]);

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
    addressedActive ?? items.find((p) => p.id === activeId) ?? null;

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
    void reload(status);
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
                setStatus(v as StatusFilter);
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
                    onClick={() => void loadMore()}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground border-border border-t px-3 py-3 text-sm font-medium transition-colors disabled:opacity-60"
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
