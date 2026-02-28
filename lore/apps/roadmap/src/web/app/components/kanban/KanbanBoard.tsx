import { ActionButton, Flex, useToast } from "@alepha/ui";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Badge, Drawer, Loader, ScrollArea } from "@mantine/core";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useId, useMemo, useState } from "react";
import type { KanbanController } from "../../../../api/controllers/KanbanController.ts";
import type { TaskController } from "../../../../api/controllers/TaskController.ts";
import type { Project } from "../../../../api/entities/projects.ts";
import type { TaskResource } from "../../../../api/schemas/taskResourceSchema.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "../../atoms/kanbanProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskView from "../project/task/TaskView.tsx";
import KanbanColumn from "./KanbanColumn.tsx";

type TaskStatus = "new" | "accepted" | "completed";

interface KanbanBoardProps {
  project: Project;
  tasks: TaskResource[];
  readOnly: boolean;
}

const KanbanBoard = ({
  project,
  tasks: initialTasks,
  readOnly,
}: KanbanBoardProps) => {
  const [tasks, setTasks] = useState<TaskResource[]>(initialTasks);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskResource | null>(null);
  const [, setKanbanProject] = useStore(kanbanProjectAtom);
  const [reloadKey] = useStore(kanbanReloadAtom);
  const taskApi = useClient<TaskController>();
  const kanbanApi = useClient<KanbanController>();
  const { tr } = useI18n<I18n, "en">();
  const toast = useToast();
  const dndId = useId();

  useEffect(() => {
    setKanbanProject({ project, readOnly });
    return () => setKanbanProject(undefined as any);
  }, [project, readOnly]);

  useEffect(() => {
    if (reloadKey?.key) reload();
  }, [reloadKey]);

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
    const result: Record<TaskStatus, TaskResource[]> = {
      new: [],
      accepted: [],
      completed: [],
    };
    for (const task of filteredTasks) {
      result[task.metadata.status].push(task);
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

    const task = taskData.task as TaskResource;
    const fromStatus = task.metadata.status;
    const toStatus = columnData.status as TaskStatus;

    if (fromStatus === toStatus) return;

    if (fromStatus === "completed") {
      toast.danger({ message: String(tr("kanban.error.completedCannotMove")) });
      return;
    }

    if (fromStatus === "new" && toStatus === "completed") {
      toast.warning({ message: String(tr("kanban.error.acceptFirst")) });
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
      toast.danger({
        message: error?.message || String(tr("kanban.error.actionFailed")),
      });
    }
  };

  return (
    <Flex direction="column" flex={1} style={{ overflow: "hidden" }}>
      {/* Zone filter nav */}
      <Flex surface borderedBottom centerY gap={4} px="sm" py={6}>
        <ScrollArea type="auto" scrollbars="x" style={{ flex: 1 }}>
          <Flex gap={4} align="center">
            {readOnly && (
              <Badge size="xs" variant="light" color="gray" mr={4}>
                {tr("kanban.readOnly")}
              </Badge>
            )}
            {loading && <Loader type="dots" size="xs" />}
            <ActionButton
              size="xs"
              variant={activeZone === null ? "filled" : "default"}
              onClick={() => setActiveZone(null)}
            >
              {tr("kanban.filter.all")}
            </ActionButton>
            {project.packages.map((zone: string) => (
              <ActionButton
                key={zone}
                size="xs"
                variant={activeZone === zone ? "filled" : "default"}
                onClick={() => setActiveZone(activeZone === zone ? null : zone)}
              >
                {zone}
              </ActionButton>
            ))}
          </Flex>
        </ScrollArea>
      </Flex>

      {/* Columns */}
      <Flex flex={1} style={{ overflow: "hidden" }}>
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
