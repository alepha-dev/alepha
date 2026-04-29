import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskGroup from "./TaskGroup.tsx";

export interface TaskListProps {
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

  const packageList = useMemo(
    () => Object.keys(groupByPackage).sort(),
    [groupByPackage],
  );

  if (packageList.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-3">
        <span className="text-muted-foreground text-sm">
          {tr("quest-log.empty")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {packageList.map((key) => (
        <TaskGroup key={key} name={key} tasks={groupByPackage[key]} />
      ))}
    </div>
  );
};

export default TaskList;
