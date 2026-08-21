import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { DateTimeProvider } from "alepha/datetime";
import { ClientOnly, useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Clock, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface QuestViewTimerProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

const QuestViewTimer = (props: QuestViewTimerProps) => {
  const { quest } = props;
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const dateTime = useInject(DateTimeProvider);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const calculateTotalTime = () => {
    if (!quest.timerSessions) return 0;
    let total = 0;
    const now = dateTime.nowMillis();
    for (const session of quest.timerSessions) {
      const start = new Date(session.startedAt).getTime();
      const stop = session.stoppedAt
        ? new Date(session.stoppedAt).getTime()
        : now;
      total += stop - start;
    }
    return Math.floor(total / 1000);
  };

  const isTimerRunning = () => {
    if (!quest.timerSessions || quest.timerSessions.length === 0) return false;
    const lastSession = quest.timerSessions[quest.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const toggleTimer = async () => {
    if (isTimerRunning()) {
      const updatedQuest = await client.stopTimer({ params: { id: quest.id } });
      props.onUpdate(updatedQuest);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } else {
      const updatedQuest = await client.startTimer({
        params: { id: quest.id },
      });
      props.onUpdate(updatedQuest);
    }
  };

  useEffect(() => {
    setCurrentTime(calculateTotalTime());
    if (isTimerRunning()) {
      intervalRef.current = setInterval(() => {
        setCurrentTime(calculateTotalTime());
      }, 1000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [quest.timerSessions]);

  if (!quest.acceptedAt || quest.completedAt) return null;
  if (!client.startTimer.can() && !client.stopTimer.can()) return null;

  const running = isTimerRunning();

  return (
    // Spans the rail rather than sitting in a centred pill: it is the first
    // thing in the panel and the mockup gives it the full width, with the
    // elapsed time leading and the control pinned to the far edge. The
    // trailing hairline the old pill needed to bridge to the panel edge goes
    // with it.
    <div className="border-border bg-background flex items-center gap-2 rounded-md border px-3 py-2">
      <Clock className="size-4 opacity-60" />
      <ClientOnly>
        <span className="flex-1 text-base font-medium">
          {formatTime(currentTime)}
        </span>
      </ClientOnly>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1"
              onClick={toggleTimer}
              disabled={!client.startTimer.can() && !client.stopTimer.can()}
            />
          }
        >
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
        </TooltipTrigger>
        <TooltipContent>
          {running
            ? tr("quest.view.timer.pause")
            : tr("quest.view.timer.start")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export default QuestViewTimer;
