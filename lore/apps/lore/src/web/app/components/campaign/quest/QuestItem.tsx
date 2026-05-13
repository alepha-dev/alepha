import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useActive, useRouter } from "alepha/react/router";
import {
  Clock,
  NotebookText,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestDifficulty from "./QuestDifficulty.tsx";

export interface QuestItemProps {
  quest: QuestResource;
  index: number;
}

const stripHtml = (html: string) => {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
};

const QuestItem = (props: QuestItemProps) => {
  const { quest } = props;

  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const router = useRouter<AppRouter>();
  const { isActive, anchorProps } = useActive(
    router.path("campaignQuest", { params: { shortId: quest.shortId } }),
  );

  const clearNote = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const updatedQuest = await client.updateQuestNote({
      params: { id: quest.id },
      body: { note: "" },
    });
    const currentQuests = alepha.store.get(currentAssignedQuestsAtom) || [];
    const updatedQuests = currentQuests.map((t) =>
      t.id === updatedQuest.id ? updatedQuest : t,
    );
    alepha.store.set(currentAssignedQuestsAtom, updatedQuests);
  };

  const isTimerRunning = () => {
    if (!quest.timerSessions || quest.timerSessions.length === 0) return false;
    const lastSession = quest.timerSessions[quest.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  const targetHref = isActive ? router.path("campaign") : anchorProps.href;

  return (
    <Link
      href={targetHref}
      className={[
        "flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 transition-colors hover:bg-accent",
        isActive
          ? "border-primary ring-1 ring-primary/40 ring-inset"
          : "border-transparent",
      ].join(" ")}
    >
      <div className="flex flex-1 items-center gap-2">
        <QuestDifficulty difficulty={quest.difficulty} />
        <span className="text-sm">{quest.title}</span>
        {quest.metadata.objectivesProgress.total > 1 && (
          <span className="text-[10px] opacity-70">
            {quest.metadata.objectivesProgress.completed}/
            {quest.metadata.objectivesProgress.total}
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-1">
        {isTimerRunning() && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Clock
                className="size-4 fill-blue-500/20 text-blue-500"
                strokeWidth={2}
              />
            </TooltipTrigger>
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

        {quest.note?.trim() && (
          <Tooltip>
            <TooltipTrigger asChild>
              <NotebookText className="size-4 text-amber-500" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-pre-wrap bg-amber-500 text-black">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{stripHtml(quest.note)}</span>
                {client.updateQuestNote.can() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-black hover:bg-black/10"
                    onClick={clearNote}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}

        {quest.priority === "optional" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Sparkles className="text-muted-foreground size-4" />
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
            <TooltipTrigger asChild>
              <TriangleAlert className="size-4 text-red-500" />
            </TooltipTrigger>
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
