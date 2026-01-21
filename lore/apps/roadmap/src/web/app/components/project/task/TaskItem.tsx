import { useAlepha, useClient } from "@alepha/react";
import { useActive, useRouter } from "@alepha/react/router";
import { ActionButton } from "@alepha/ui";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ActionIcon, Box, Flex, HoverCard, Text } from "@mantine/core";
import {
  IconClock,
  IconExclamationMark,
  IconNotes,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import type { TaskController } from "../../../../../api/controllers/TaskController.ts";
import type { Task } from "../../../../../api/entities/tasks.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentAssignedTasksAtom } from "../../../atoms/currentAssignedTasksAtom.ts";
import TaskComplexity from "./TaskComplexity.tsx";

const TaskItem = (props: { task: Task; index: number }) => {
  const { task } = props;

  const alepha = useAlepha();
  const client = useClient<TaskController>();
  const router = useRouter<AppRouter>();
  const { isActive, anchorProps } = useActive(
    router.path("projectTask", { params: { taskId: task.id } }),
  );

  const clearNote = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const updatedTask = await client.updateTaskNote({
      params: { id: task.id },
      body: { note: "" },
    });
    // Update in assigned tasks atom
    const currentTasks = alepha.store.get(currentAssignedTasksAtom) || [];
    const updatedTasks = currentTasks.map((t) =>
      t.id === updatedTask.id ? updatedTask : t,
    );
    alepha.store.set(currentAssignedTasksAtom, updatedTasks);
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      attributes: {
        tabIndex: task.id,
      },
      id: `task-${task.id}`,
      data: {
        type: "task",
        task: task,
      },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
    width: "100%",
  };

  // Check if timer is running
  const isTimerRunning = () => {
    if (!task.timerSessions || task.timerSessions.length === 0) return false;
    const lastSession = task.timerSessions[task.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ActionButton
        href={isActive ? router.path("project") : anchorProps.href}
        active={{
          href: anchorProps.href,
        }}
        variant={isActive ? "light" : "subtle"}
        justify={"space-between"}
        {...attributes}
        {...listeners}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          width: "100%",
        }}
        rightSection={
          <Flex align="center" justify="center" gap={4}>
            {isTimerRunning() && (
              <HoverCard openDelay={600} position="bottom-end">
                <HoverCard.Target>
                  <Box
                    px={1}
                    className="timer-active-indicator"
                    style={{
                      display: "flex",
                    }}
                  >
                    <IconClock
                      size={18}
                      color="var(--mantine-color-blue-5)"
                      fill="var(--mantine-color-blue-5)"
                      fillOpacity={0.2}
                    />
                  </Box>
                </HoverCard.Target>
                <HoverCard.Dropdown>
                  <Flex p={"xs"} direction={"column"}>
                    <Text fw={"bold"} size="sm">
                      Timer Running
                    </Text>
                    <Text size="xs">
                      Time tracking is active for this quest.
                    </Text>
                  </Flex>
                </HoverCard.Dropdown>
              </HoverCard>
            )}
            {task.note?.trim() && (
              <HoverCard
                transitionProps={{
                  transition: "fade-right",
                }}
                closeDelay={800}
                openDelay={400}
                position="right"
              >
                <HoverCard.Target>
                  <Flex px={1}>
                    <IconNotes size={18} color={"#f59f00"} />
                  </Flex>
                </HoverCard.Target>
                <HoverCard.Dropdown
                  style={{
                    borderRadius: 12,
                    backgroundColor: "rgba(245,159,0)",
                    borderColor: "transparent",
                  }}
                >
                  <Flex p={"xs"} direction={"column"} gap={"xs"}>
                    <Flex justify={"space-between"} align={"center"} gap={"sm"}>
                      <Text
                        fw={"bold"}
                        size="md"
                        c={"black"}
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {task.note}
                      </Text>
                      {client.updateTaskNote.can() && (
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="dark"
                          onClick={clearNote}
                          style={{ flexShrink: 0 }}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Flex>
                  </Flex>
                </HoverCard.Dropdown>
              </HoverCard>
            )}
            {task.priority === "optional" ? (
              <HoverCard openDelay={1000} position="bottom-start">
                <HoverCard.Target>
                  <Flex px={1}>
                    <IconSparkles color={"var(--alepha-text-muted)"} />
                  </Flex>
                </HoverCard.Target>
                <HoverCard.Dropdown>
                  <Flex p={"xs"} direction={"column"}>
                    <Text fw={"bold"}>Bonus</Text>
                    <Text size="sm">This quest is optional.</Text>
                  </Flex>
                </HoverCard.Dropdown>
              </HoverCard>
            ) : task.priority === "high" ? (
              <HoverCard openDelay={1000} position="bottom-start">
                <HoverCard.Target>
                  <Flex px={1}>
                    <IconExclamationMark color={"var(--color-high-priority)"} />
                  </Flex>
                </HoverCard.Target>
                <HoverCard.Dropdown>
                  <Flex p={"xs"} direction={"column"}>
                    <Text fw={"bold"}>High Priority !</Text>
                    <Text size="sm">Which means more rewards.</Text>
                  </Flex>
                </HoverCard.Dropdown>
              </HoverCard>
            ) : null}
          </Flex>
        }
      >
        <Flex flex={1} align={"center"} gap={"sm"}>
          <TaskComplexity complexity={task.complexity} />
          <Text c={isActive ? "white" : undefined}>{task.title}</Text>
          {!!task.objectives.length && task.objectives.length > 1 && (
            <Text c={isActive ? "white" : undefined} size={"10px"}>
              {task.objectives.filter((it) => it.completed).length}/
              {task.objectives.length}
            </Text>
          )}
        </Flex>
      </ActionButton>
    </div>
  );
};

export default TaskItem;
