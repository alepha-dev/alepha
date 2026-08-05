import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  Edit,
  Signature,
  Sunrise,
  Swords,
  X,
} from "lucide-react";
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
    if (action === "shelved") return "Set Aside";
    if (action === "unshelved") return "Back in Play";
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
      icon: <Swords className="size-4" />,
      when: quest.completedAt,
      description: (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">
            Quest has been completed by <span className="font-bold">You</span>.
          </span>
          {summaryPreview && (
            <span className="block text-muted-foreground text-xs italic truncate">
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
          <Signature className="size-4" />
        ) : it.action === "objective_completed" ? (
          <CheckSquare className="size-4" />
        ) : it.action === "unassigned" ? (
          <X className="size-4" />
        ) : it.action === "shelved" ? (
          <Archive className="size-4" />
        ) : it.action === "unshelved" ? (
          <ArchiveRestore className="size-4" />
        ) : (
          <Edit className="size-4" />
        ),
      when: it.at,
      description: descriptionFor(it.action),
    });
  }

  entries.push({
    action: "created",
    icon: <Sunrise className="size-4" />,
    when: quest.createdAt,
    description: (
      <span className="text-muted-foreground text-sm">
        Quest has been created by <span className="font-bold">You</span>.
      </span>
    ),
  });

  return (
    <ol className="flex w-full flex-col">
      {entries.map((entry, i) => {
        const isLast = i === entries.length - 1;
        return (
          <li
            key={`${entry.when}-${i}`}
            className="flex gap-3"
            style={{ animation: "fadeInUpLight 0.3s ease forwards" }}
          >
            <div className="flex flex-col items-center">
              <span className="bg-card border-border flex size-9 shrink-0 items-center justify-center rounded-md border shadow-sm">
                {entry.icon}
              </span>
              {!isLast && <span className="bg-border my-1 w-px flex-1" />}
            </div>
            <div
              className={`flex min-w-0 flex-1 flex-col ${isLast ? "" : "pb-6"}`}
            >
              <span className="text-muted-foreground text-xs">
                {dt.of(entry.when).format("LL")}
              </span>
              <span className="text-sm font-bold">
                {titleFor(entry.action)}
              </span>
              <div className="mt-0.5">{entry.description}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default QuestHistoryTimeline;
