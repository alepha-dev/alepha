import { Flex, Text } from "@alepha/react-flex";
import { Minus, Plus } from "@blueprintjs/icons";
import { useState } from "react";
import type { Task } from "../../../api/providers/Db.ts";
import TaskItem from "./TaskItem.tsx";

interface TaskGroupProps {
	name: string;
	tasks: Task[];
}

const TaskGroup = (props: TaskGroupProps) => {
	const [isCollapsed, setIsCollapsed] = useState(true);

	// sort by complexity
	const tasks = [...props.tasks].sort((a, b) =>
		a.complexity - b.complexity > 0 ? -1 : 1,
	);

	return (
		<Flex col>
			<Flex card pad1 centerX onClick={() => setIsCollapsed(!isCollapsed)}>
				<Flex centerX gap1>
					{isCollapsed ? <Minus size={10} /> : <Plus size={10} />}
					<Text bold>{props.name}</Text>
				</Flex>
				<Flex fill center pad2h>
					<Flex
						style={{
							height: 1,
							opacity: 0.2,
							width: "100%",
							backgroundColor: "var(--text-muted)",
						}}
					/>
				</Flex>
				<Flex>
					<Text muted small>
						{props.tasks.length} task{props.tasks.length > 1 ? "s" : ""}
					</Text>
				</Flex>
			</Flex>
			{isCollapsed && (
				<Flex col style={{ gap: 4 }}>
					{tasks.map((item) => (
						<TaskItem key={item.id} task={item} />
					))}
				</Flex>
			)}
		</Flex>
	);
};

export default TaskGroup;
