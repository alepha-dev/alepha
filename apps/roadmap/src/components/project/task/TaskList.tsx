import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { useMemo } from "react";
import type { Task } from "../../../providers/Db.ts";
import type { I18n } from "../../../services/I18n.ts";
import TaskGroup from "./TaskGroup.tsx";

interface TaskListProps {
	tasks: Task[];
}

const TaskList = (props: TaskListProps) => {
	const { tr } = useI18n<I18n, "en">();

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

	if (packageList.length === 0) {
		return (
			<Flex pad2 col centerX fill>
				<Text muted>{tr("roadmap.quest-log.empty")}</Text>
			</Flex>
		);
	}

	return (
		<Flex col>
			{packageList.map((key) => (
				<TaskGroup name={key} tasks={groupByPackage[key]} key={key} />
			))}
		</Flex>
	);
};

export default TaskList;
