import { useI18n } from "@alepha/react-i18n";
import { Flex, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import type { Task } from "../../../api/providers/Db.ts";
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
		<Stack gap={0}>
			{packageList.map((key) => (
				<TaskGroup name={key} tasks={groupByPackage[key]} key={key} />
			))}
		</Stack>
	);
};

export default TaskList;
