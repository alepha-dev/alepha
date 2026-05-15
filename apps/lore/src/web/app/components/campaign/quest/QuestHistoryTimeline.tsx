import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { CheckSquare, Edit, Signature, Sunrise, Swords, X } from "lucide-react";
import type { ReactNode } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

export interface QuestHistoryTimelineProps {
  quest: QuestResource;
}

interface TimelineEntry {
  action: string;
  icon: ReactNode;
  when: string;
  description: ReactNode;
}

const QuestHistoryTimeline = (props: QuestHistoryTimelineProps) => {
  const { quest } = props;
  const dt = useInject(DateTimeProvider);

  const titleFor = (action: string) => {
    if (action === "assigned") return "Courageous Choice";
    if (action === "unassigned") return "Fateful Decision";
    if (action === "completed") return "At Long Last";
    if (action === "created") return "A New Dawn";
    if (action === "objective_completed") return "Objective Achieved";
    return "Notable Change";
  };

  const descriptionFor = (action: string): ReactNode => {
    if (action === "objective_completed") {
      return (
        <span className="text-muted-foreground text-sm">
          Objective has been completed by <span className="font-bold">You</span>
          .
        </span>
      );
    }
    return (
      <span className="text-muted-foreground text-sm">
        Quest has been {action} by <span className="font-bold">You</span>.
      </span>
    );
  };

  const entries: TimelineEntry[] = [];

  // Strip markdown/HTML and collapse whitespace so the timeline preview stays
  // single-line even if the completer dropped a full multi-paragraph summary.
  const previewCompletion = (raw: string) =>
    raw
      .replace(/<[^>]*>/g, "")
      .replace(/[#*_`~>-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);

  if (quest.completedAt) {
    const summaryPreview = quest.completionMessage
      ? previewCompletion(quest.completionMessage)
      : undefined;
    entries.push({
      action: "completed",
      icon: <Swords className="size-3" />,
      when: quest.completedAt,
      description: (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">
            Quest has been completed by <span className="font-bold">You</span>.
          </span>
          {summaryPreview && (
            <span className="text-muted-foreground text-xs italic truncate">
              “{summaryPreview}”
            </span>
          )}
        </div>
      ),
    });
  }

  for (const it of quest.history.toReversed()) {
    entries.push({
      action: it.action,
      icon:
        it.action === "assigned" ? (
          <Signature className="size-3" />
        ) : it.action === "objective_completed" ? (
          <CheckSquare className="size-3" />
        ) : it.action === "unassigned" ? (
          <X className="size-3" />
        ) : (
          <Edit className="size-3" />
        ),
      when: it.at,
      description: descriptionFor(it.action),
    });
  }

  entries.push({
    action: "created",
    icon: <Sunrise className="size-3" />,
    when: quest.createdAt,
    description: (
      <span className="text-muted-foreground text-sm">
        Quest has been created by <span className="font-bold">You</span>.
      </span>
    ),
  });

  return (
    <ol className="relative flex w-full flex-col gap-3 border-l ms-3 pl-5">
      {entries.map((entry, i) => (
        <li
          key={`${entry.when}-${i}`}
          className="relative"
          style={{ animation: "fadeInUpLight 0.3s ease forwards" }}
        >
          <span className="bg-card border-border absolute -left-[31px] flex size-6 items-center justify-center rounded-full border">
            {entry.icon}
          </span>
          <div className="flex justify-between gap-2">
            <div className="flex flex-1 flex-col">
              <span className="text-sm">{titleFor(entry.action)}</span>
              <div>{entry.description}</div>
            </div>
            <span className="text-muted-foreground mt-1 text-xs">
              {dt.of(entry.when).fromNow()}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
};

export default QuestHistoryTimeline;
