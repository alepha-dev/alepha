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
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface TaskViewTimerProps {
  task: TaskResource;
  onUpdate: (task: TaskResource) => void;
}

const TaskViewTimer = (props: TaskViewTimerProps) => {
  const { task } = props;
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<TaskController>();
  const dateTime = useInject(DateTimeProvider);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const calculateTotalTime = () => {
    if (!task.timerSessions) return 0;
    let total = 0;
    const now = dateTime.nowMillis();
    for (const session of task.timerSessions) {
      const start = new Date(session.startedAt).getTime();
      const stop = session.stoppedAt
        ? new Date(session.stoppedAt).getTime()
        : now;
      total += stop - start;
    }
    return Math.floor(total / 1000);
  };

  const isTimerRunning = () => {
    if (!task.timerSessions || task.timerSessions.length === 0) return false;
    const lastSession = task.timerSessions[task.timerSessions.length - 1];
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
      const updatedTask = await client.stopTimer({ params: { id: task.id } });
      props.onUpdate(updatedTask);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } else {
      const updatedTask = await client.startTimer({ params: { id: task.id } });
      props.onUpdate(updatedTask);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.timerSessions]);

  if (!task.acceptedAt || task.completedAt) return null;
  if (!client.startTimer.can() && !client.stopTimer.can()) return null;

  const running = isTimerRunning();

  return (
    <div className="flex items-center">
      <div className="border-border flex min-w-[150px] items-center justify-end gap-2 rounded-md border px-2 py-0.5 shadow-sm">
        <Clock className="size-4 opacity-60" />
        <ClientOnly>
          <span className="text-sm font-medium">{formatTime(currentTime)}</span>
        </ClientOnly>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1"
              onClick={toggleTimer}
              disabled={!client.startTimer.can() && !client.stopTimer.can()}
            >
              {running ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {running
              ? tr("task.view.timer.pause")
              : tr("task.view.timer.start")}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="bg-border ml-2 h-px w-8 opacity-40" />
    </div>
  );
};

export default TaskViewTimer;
