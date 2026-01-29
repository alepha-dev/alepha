import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Flex, Stack, Text } from "@mantine/core";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useId, useMemo } from "react";
import type { TaskController } from "../../../../../api/controllers/TaskController.ts";
import type { Task } from "../../../../../api/entities/tasks.ts";
import { currentAssignedTasksAtom } from "../../../atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import TaskGroup from "./TaskGroup.tsx";

interface TaskListProps {
  tasks: Task[];
}

const TaskList = (props: TaskListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const taskApi = useClient<TaskController>();
  const alepha = useAlepha();
  const id = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const groupByPackage = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const task of props.tasks) {
      grouped[task.package] ??= [];
      grouped[task.package].push(task);
    }
    return grouped;
  }, [props.tasks]);

  const packageList = useMemo(() => {
    return Object.keys(groupByPackage).sort();
  }, [groupByPackage]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const taskData = active.data.current;
    const zoneData = over.data.current;

    if (taskData?.type === "task" && zoneData?.type === "zone") {
      const task = taskData.task as Task;
      const newZoneName = zoneData.zoneName as string;

      // Don't update if already in the same zone
      if (task.package === newZoneName) {
        return;
      }

      try {
        const updatedTask = await taskApi.moveTaskToZone({
          params: { id: task.id },
          body: { newZone: newZoneName },
        });

        // Update local state
        const currentTasks = alepha.store.get(currentAssignedTasksAtom) || [];
        const updatedTasks = currentTasks.map((t) =>
          t.id === updatedTask.id ? updatedTask : t,
        );
        alepha.store.set(currentAssignedTasksAtom, updatedTasks);

        // Update project packages if needed
        const currentProject = alepha.store.get(currentProjectAtom);
        if (currentProject && !currentProject.packages.includes(newZoneName)) {
          alepha.store.set(currentProjectAtom, {
            ...currentProject,
            packages: [...currentProject.packages, newZoneName],
          });
        }
      } catch (error) {
        console.error("Failed to move task:", error);
      }
    }
  };

  if (packageList.length === 0) {
    return (
      <Flex
        p={"sm"}
        direction={"column"}
        align="center"
        justify="center"
        flex={1}
      >
        <Text c={"dimmed"}>{tr("quest-log.empty")}</Text>
      </Flex>
    );
  }

  return (
    <DndContext id={id} sensors={sensors} onDragEnd={handleDragEnd}>
      <Stack gap={0}>
        {packageList.map((key) => (
          <TaskGroup name={key} tasks={groupByPackage[key]} key={key} />
        ))}
      </Stack>
    </DndContext>
  );
};

export default TaskList;
