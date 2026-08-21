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
}

const ProjectFeedback = (props: ProjectFeedbackProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [, setFeedbackCount] = useStore(currentFeedbackCountAtom);
  const feedbackApi = useClient<FeedbackController>();

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<FeedbackResource[]>(props.items ?? []);
  const [activeId, setActiveId] = useState<number | null>(
    props.items?.[0]?.id ?? null,
  );

  // No loading indicator on purpose: the status switch refetches in ~300ms and
  // a spinner next to the segmented control reads as flicker (feedback #11).
  const reload = async (next: StatusFilter = status) => {
    if (!project) return;
    const res = await feedbackApi.listFeedback({
      params: { projectId: project.id },
      query: { status: next },
    });
    setItems(res.items);
    setActiveId(res.items[0]?.id ?? null);
    if (next === "pending") {
      setFeedbackCount({ count: res.items.length });
    } else {
      feedbackApi
        .listFeedback({
          params: { projectId: project.id },
          query: { status: "pending" },
        })
        .then((r) => setFeedbackCount({ count: r.items.length }))
        .catch(() => {});
    }
  };

  useEffect(() => {
    if (status === "pending" && props.items && items === props.items) {
      setFeedbackCount({ count: props.items.length });
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
