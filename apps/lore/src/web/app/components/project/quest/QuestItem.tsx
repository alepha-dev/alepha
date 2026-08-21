import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useActive, useRouter } from "alepha/react/router";
import { Clock, Sparkles, TriangleAlert } from "lucide-react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatEstimate } from "./questEstimate.ts";

export interface QuestItemProps {
  quest: QuestResource;
  index: number;
}

const QuestItem = (props: QuestItemProps) => {
  const { quest } = props;

  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const questEstimateEnabled = project?.features?.questEstimate === true;
  const { isActive, anchorProps } = useActive(
    router.path("projectQuest", { params: { shortId: quest.shortId } }),
  );

  const isTimerRunning = () => {
    if (!quest.timerSessions || quest.timerSessions.length === 0) return false;
    const lastSession = quest.timerSessions[quest.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  const targetHref = isActive ? router.path("project") : anchorProps.href;

  return (
    <Link
      href={targetHref}
      className={[
        "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent",
        isActive ? "bg-accent font-medium" : "bg-card",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {questEstimateEnabled && quest.estimateMinutes != null && (
          <span
            className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-0.5 font-mono text-[10px] leading-none"
            title={tr("quest.item.estimate")}
          >
            ~{formatEstimate(quest.estimateMinutes)}
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate text-sm"
          title={`#${quest.shortId} - ${quest.title}`}
        >
          #{quest.shortId} <span className="text-muted-foreground">-</span>{" "}
          {quest.title}
        </span>
        {quest.metadata.objectivesProgress.total > 1 && (
          <span className="shrink-0 text-[10px] opacity-70">
            {quest.metadata.objectivesProgress.completed}/
            {quest.metadata.objectivesProgress.total}
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-1">
        {isTimerRunning() && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Clock
                  className="size-4 fill-blue-500/20 text-blue-500"
                  strokeWidth={2}
                />
              }
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

        {quest.priority === "optional" ? (
          <Tooltip>
            <TooltipTrigger
              render={<Sparkles className="text-muted-foreground size-4" />}
            />
            <TooltipContent className="flex flex-col gap-0.5">
              <span className="font-bold">{tr("quest.item.bonus")}</span>
              <span className="text-xs">
                {tr("quest.item.bonus.description")}
              </span>
            </TooltipContent>
          </Tooltip>
        ) : quest.priority === "high" ? (
          <Tooltip>
            <TooltipTrigger
              render={<TriangleAlert className="size-4 text-red-500" />}
            />
            <TooltipContent className="flex flex-col gap-0.5">
              <span className="font-bold">{tr("quest.item.highPriority")}</span>
              <span className="text-xs">
                {tr("quest.item.highPriority.description")}
              </span>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </Link>
  );
};

export default QuestItem;
