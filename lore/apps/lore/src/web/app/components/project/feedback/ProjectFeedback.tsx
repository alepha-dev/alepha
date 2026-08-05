import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";
import { currentFeedbackCountAtom } from "../../../atoms/currentFeedbackCountAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import ProjectFeedbackCard from "./ProjectFeedbackCard.tsx";
import ProjectFeedbackDetail from "./ProjectFeedbackDetail.tsx";

type StatusFilter = "pending" | "accepted" | "rejected" | "all";

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
    reload(status);
  }, [status]);

  const active = items.find((p) => p.id === activeId) ?? null;

  const onChanged = () => {
    reload(status);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* List + detail split */}
      <div className="flex min-h-0 flex-1">
        {/* Left list */}
        <aside
          className={cn(
            "flex w-full flex-col border-r md:w-[300px] md:shrink-0",
            active && "hidden md:flex",
          )}
        >
          <div className="border-border flex items-center gap-2 border-b p-2">
            <Segmented
              value={status}
              onChange={(v) => setStatus(v as StatusFilter)}
              options={[
                {
                  value: "pending",
                  label: tr("feedback.filter.pending"),
                },
                {
                  value: "accepted",
                  label: tr("feedback.filter.accepted"),
                },
                {
                  value: "rejected",
                  label: tr("feedback.filter.rejected"),
                },
                { value: "all", label: tr("feedback.filter.all") },
              ]}
              size="sm"
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
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <Inbox className="size-10 opacity-50" />
              <p className="text-sm">{tr("feedback.empty.selectOne")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ProjectFeedback;
