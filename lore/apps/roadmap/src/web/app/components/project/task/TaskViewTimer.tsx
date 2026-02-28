import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  IconClock,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { ClientOnly, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useRef, useState } from "react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface TaskViewTimerProps {
  task: TaskResource;
  onUpdate: (task: TaskResource) => void;
}

const TaskViewTimer = (props: TaskViewTimerProps) => {
  const { task } = props;
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<TaskController>();
  const [currentTime, setCurrentTime] = useState<number>(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate total time from all sessions
  const calculateTotalTime = () => {
    if (!task.timerSessions) return 0;

    let total = 0;
    const now = new Date();

    for (const session of task.timerSessions) {
      const start = new Date(session.startedAt);
      const stop = session.stoppedAt ? new Date(session.stoppedAt) : now;
      total += stop.getTime() - start.getTime();
    }

    return Math.floor(total / 1000); // Return in seconds
  };

  // Check if timer is running
  const isTimerRunning = () => {
    if (!task.timerSessions || task.timerSessions.length === 0) return false;
    const lastSession = task.timerSessions[task.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  // Format time display
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  // Start/stop timer
  const toggleTimer = async () => {
    if (isTimerRunning()) {
      const updatedTask = await client.stopTimer({
        params: { id: task.id },
      });
      props.onUpdate(updatedTask);

      // Clear interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } else {
      const updatedTask = await client.startTimer({
        params: { id: task.id },
      });
      props.onUpdate(updatedTask);
    }
  };

  // Update timer display
  useEffect(() => {
    // Set initial time
    setCurrentTime(calculateTotalTime());

    // If timer is running, update every second
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
  }, [task.timerSessions]);

  // Don't show timer if task is not accepted or already completed
  if (!task.acceptedAt || task.completedAt) {
    return null;
  }

  // Don't show if user doesn't have permission
  if (!client.startTimer.can() && !client.stopTimer.can()) {
    return null;
  }

  const running = isTimerRunning();

  return (
    <Flex align="center">
      <Flex
        className={"shadow"}
        align="center"
        gap="xs"
        ml={"xs"}
        px={"xs"}
        py={2}
        bdrs={"md"}
        miw={150}
        justify={"end"}
        bd={"1px solid var(--alepha-border)"}
      >
        <IconClock size={theme.icon.size.sm} opacity={0.6} />
        <ClientOnly>
          <Text size="sm" fw={500}>
            {formatTime(currentTime)}
          </Text>
        </ClientOnly>
        <ActionButton
          bd={0}
          px={"xs"}
          variant={"minimal"}
          tooltip={
            running ? tr("task.view.timer.pause") : tr("task.view.timer.start")
          }
          onClick={toggleTimer}
          disabled={!client.startTimer.can() && !client.stopTimer.can()}
        >
          {running ? (
            <IconPlayerPause size={theme.icon.size.md} />
          ) : (
            <IconPlayerPlay size={theme.icon.size.md} />
          )}
        </ActionButton>
      </Flex>

      <Flex
        flex={1}
        ml={"xs"}
        style={{
          width: 32,
          opacity: 0.1,
          height: 1,
          backgroundColor: "var(--alepha-text)",
        }}
      />
    </Flex>
  );
};

export default TaskViewTimer;
