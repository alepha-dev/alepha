import { Flex, Text } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskGroup from "./TaskGroup.tsx";

interface TaskListProps {
  tasks: TaskResource[];
}

const TaskList = (props: TaskListProps) => {
  const { tr } = useI18n<I18n, "en">();

  const groupByPackage = useMemo(() => {
    const grouped: Record<string, TaskResource[]> = {};
    for (const task of props.tasks) {
      grouped[task.package] ??= [];
      grouped[task.package].push(task);
    }
    return grouped;
  }, [props.tasks]);

  const packageList = useMemo(() => {
    return Object.keys(groupByPackage).sort();
  }, [groupByPackage]);

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
    <Flex direction="column" gap={"xs"}>
      {packageList.map((key) => (
        <TaskGroup name={key} tasks={groupByPackage[key]} key={key} />
      ))}
    </Flex>
  );
};

export default TaskList;
