import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
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
    setActiveId(res.items[0]?.id ?? null);
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

  const active = items.find((p) => p.id === activeId) ?? null;

  const onChanged = () => {
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
              onChange={(v) => setStatus(v as StatusFilter)}
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
                    selected={feedback.id === activeId}
                    onClick={() => setActiveId(feedback.id)}
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
        <section className={cn("min-w-0 flex-1", !active && "hidden md:block")}>
          {active ? (
            <ProjectFeedbackDetail
              feedback={active}
              onChanged={onChanged}
              onBack={() => setActiveId(null)}
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
