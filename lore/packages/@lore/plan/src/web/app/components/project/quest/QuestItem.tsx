import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import {
  currentProjectAtom,
  type I18n,
  capabilityOption,
  formatReference,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useActive, useRouter } from "alepha/react/router";
import { Clock } from "lucide-react";

import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import { QUEST_PRIORITY_ICONS } from "./questChips.ts";
import { formatEstimate } from "./questEstimate.ts";

export interface QuestItemProps {
  quest: QuestResource;
  index: number;
}

const QuestItem = (props: QuestItemProps) => {
  const { quest } = props;

  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const questEstimateEnabled = capabilityOption(project, "plan", "estimate");
  const { isActive, anchorProps } = useActive(
    router.path("projectQuest", {
      params: {
        projectSlug: router.state.params.projectSlug,
        shortId: quest.shortId,
      },
    }),
  );

  const isTimerRunning = () => {
    if (!quest.timerSessions || quest.timerSessions.length === 0) return false;
    const lastSession = quest.timerSessions[quest.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  // The row of the open quest closes it: back to the quests list.
  //
  // ⚠️ The slug is passed, never inherited. `project` declares
  // `schema.params`, and `router.path` gives such a page exactly the params
  // it was handed. Called bare, this answered the literal `/:projectSlug`: a
  // 404, and a URL, so a refresh reloaded it (feedback #P2228).
  const targetHref = isActive
    ? router.path("projectQuests", {
        params: { projectSlug: router.state.params.projectSlug },
      })
    : anchorProps.href;

  const PriorityIcon = QUEST_PRIORITY_ICONS[quest.priority];
  const priorityIcon = (
    <PriorityIcon
      className={`size-3.5 shrink-0 ${PRIORITY_TEXT[quest.priority]}`}
    />
  );
  const objectives = quest.metadata.objectivesProgress;

  return (
    <Link
      href={targetHref}
      title={`${formatReference("quest", quest.shortId)} - ${quest.title}`}
      className={[
        "group/item relative flex h-8 items-center gap-2 rounded-md pr-2 pl-6 text-sm transition-colors",
        isActive
          ? "bg-hover text-foreground font-medium"
          : "hover:bg-hover-weak",
      ].join(" ")}
    >
      {/* The open quest wears an accent bar at its left edge, so it is
          found at a glance in a long log. */}
      {isActive && (
        <span className="bg-primary absolute inset-y-1.5 left-2 w-0.5 rounded-full" />
      )}
      {/* Priority as an arrow in its tone, the Quests list's glyph. High and
          optional keep their explanation as a tooltip, as before. */}
      {quest.priority === "optional" ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex" />}>
            {priorityIcon}
          </TooltipTrigger>
          <TooltipContent className="flex flex-col gap-0.5">
            <span className="font-bold">{tr("quest.item.bonus")}</span>
            <span className="text-xs">
              {tr("quest.item.bonus.description")}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : quest.priority === "high" ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex" />}>
            {priorityIcon}
          </TooltipTrigger>
          <TooltipContent className="flex flex-col gap-0.5">
            <span className="font-bold">{tr("quest.item.highPriority")}</span>
            <span className="text-xs">
              {tr("quest.item.highPriority.description")}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : (
        priorityIcon
      )}
      <span className="min-w-0 flex-1 truncate">{quest.title}</span>
      <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
        {isTimerRunning() && (
          <Tooltip>
            <TooltipTrigger
              render={<Clock className="size-3.5 text-blue-500" />}
            />
            <TooltipContent className="flex flex-col gap-0.5">
              <span className="font-bold">
                {tr("quest.view.timer.running")}
              </span>
              <span className="text-xs">
                {tr("quest.view.timer.description")}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
        {questEstimateEnabled && quest.estimateMinutes != null && (
          <span title={tr("quest.item.estimate")}>
            ~{formatEstimate(quest.estimateMinutes)}
          </span>
        )}
        {objectives.total > 1 && (
          <span
            className={
              objectives.completed === objectives.total
                ? "text-emerald-600 dark:text-emerald-400"
                : ""
            }
          >
            {objectives.completed}/{objectives.total}
          </span>
        )}
        {/* The reference last and faint: it is for copying, not reading,
            and the title is what the reader scans. */}
        <span className="text-muted-foreground/60 font-mono text-[10px]">
          {formatReference("quest", quest.shortId)}
        </span>
      </span>
    </Link>
  );
};

/**
 * The arrow's colour per priority, the tones of the Quests list's chip.
 * Written out literally because Tailwind scans source text.
 */
const PRIORITY_TEXT: Record<QuestResource["priority"], string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-blue-500",
  optional: "text-muted-foreground",
};

export default QuestItem;
