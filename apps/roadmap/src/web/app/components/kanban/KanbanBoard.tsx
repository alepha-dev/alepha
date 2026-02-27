import { ActionButton } from "@alepha/ui";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Badge, Card, Drawer, Flex, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useClient } from "alepha/react";
import { useId, useMemo, useState } from "react";
import type { KanbanController } from "../../../../api/controllers/KanbanController.ts";
import type { TaskController } from "../../../../api/controllers/TaskController.ts";
import type { Task } from "../../../../api/entities/tasks.ts";
import { theme } from "../../constants/theme.ts";
import TaskView from "../project/task/TaskView.tsx";
import KanbanColumn from "./KanbanColumn.tsx";

type TaskStatus = "new" | "accepted" | "completed";

interface KanbanBoardProps {
  project: {
    id: number;
    title: string;
    packages: string[];
    public?: boolean;
  };
  tasks: Task[];
  readOnly: boolean;
}

const getTaskStatus = (task: Task): TaskStatus => {
  if (task.completedAt) return "completed";
  if (task.acceptedAt) return "accepted";
  return "new";
};

const KanbanBoard = ({
  project,
  tasks: initialTasks,
  readOnly,
}: KanbanBoardProps) => {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const taskApi = useClient<TaskController>();
  const kanbanApi = useClient<KanbanController>();
  const dndId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const filteredTasks = useMemo(() => {
    if (!activeZone) return tasks;
    return tasks.filter((t) => t.package === activeZone);
  }, [tasks, activeZone]);

  const grouped = useMemo(() => {
    const result: Record<TaskStatus, Task[]> = {
      new: [],
      accepted: [],
      completed: [],
    };
    for (const task of filteredTasks) {
      result[getTaskStatus(task)].push(task);
    }
    return result;
  }, [filteredTasks]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await kanbanApi.getBoard({
        params: { projectId: project.id },
      });
      setTasks(data.tasks);
    } finally {
      setLoading(false);
    }
  };

  const closeDrawer = async () => {
    setSelectedTask(null);
    await reload();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskData = active.data.current;
    const columnData = over.data.current;
    if (taskData?.type !== "task" || columnData?.type !== "column") return;

    const task = taskData.task as Task;
    const fromStatus = getTaskStatus(task);
    const toStatus = columnData.status as TaskStatus;

    if (fromStatus === toStatus) return;

    if (fromStatus === "completed") {
      notifications.show({
        message: "Completed tasks cannot be moved",
        color: "red",
        autoClose: 3000,
      });
      return;
    }

    if (fromStatus === "new" && toStatus === "completed") {
      notifications.show({
        message: "Accept the task first before completing it",
        color: "orange",
        autoClose: 3000,
      });
      return;
    }

    try {
      if (fromStatus === "new" && toStatus === "accepted") {
        await taskApi.acceptTask({ params: { id: task.id } });
      } else if (fromStatus === "accepted" && toStatus === "new") {
        await taskApi.abandonTask({ params: { id: task.id } });
      } else if (fromStatus === "accepted" && toStatus === "completed") {
        await taskApi.completeTask({ params: { id: task.id } });
      }
      await reload();
    } catch (error: any) {
      notifications.show({
        message: error?.message || "Action failed",
        color: "red",
        autoClose: 3000,
      });
    }
  };

  return (
    <Flex direction="column" h="100vh">
      {/* Header */}
      <Card
        p="sm"
        radius={0}
        withBorder
        bg={theme.colors.panel}
        style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}
      >
        <Flex justify="space-between" align="center">
          <Flex align="center" gap="sm">
            <Text fw={600} size="lg">
              {project.title}
            </Text>
            {readOnly && (
              <Badge size="xs" variant="light" color="gray">
                Read only
              </Badge>
            )}
            {loading && <Loader type="dots" size="xs" />}
          </Flex>

          {/* Zone filter */}
          <Flex gap={4} align="center">
            <ActionButton
              size="xs"
              variant={activeZone === null ? "light" : "subtle"}
              onClick={() => setActiveZone(null)}
            >
              All
            </ActionButton>
            {project.packages.map((zone: string) => (
              <ActionButton
                key={zone}
                size="xs"
                variant={activeZone === zone ? "light" : "subtle"}
                onClick={() => setActiveZone(activeZone === zone ? null : zone)}
              >
                {zone}
              </ActionButton>
            ))}
          </Flex>
        </Flex>
      </Card>

      {/* Columns */}
      <Flex flex={1} p="sm" gap="sm" className="overflow-auto">
        <DndContext id={dndId} sensors={sensors} onDragEnd={handleDragEnd}>
          <KanbanColumn
            status="new"
            tasks={grouped.new}
            readOnly={readOnly}
            onSelect={setSelectedTask}
          />
          <KanbanColumn
            status="accepted"
            tasks={grouped.accepted}
            readOnly={readOnly}
            onSelect={setSelectedTask}
          />
          <KanbanColumn
            status="completed"
            tasks={grouped.completed}
            readOnly={readOnly}
            onSelect={setSelectedTask}
            last
          />
        </DndContext>
      </Flex>

      {/* Task detail drawer */}
      <Drawer
        position="right"
        size="xl"
        opened={!!selectedTask}
        onClose={closeDrawer}
        withCloseButton={false}
        padding={0}
        className="drawer"
      >
        {selectedTask && (
          <TaskView
            task={selectedTask}
            onClose={closeDrawer}
            onTaskChange={(updated) => {
              setSelectedTask(updated);
              setTasks((prev) =>
                prev.map((t) => (t.id === updated.id ? updated : t)),
              );
            }}
          />
        )}
      </Drawer>
    </Flex>
  );
};

export default KanbanBoard;
