import { useAlepha, useClient } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Collapse, Icon, Tag } from "@blueprintjs/core";
import { type ReactNode, useState } from "react";
import type TaskApi from "../api/TaskApi.ts";
import type { Task } from "../providers/Db.ts";
import type { I18n } from "../services/I18n.ts";
import Action from "./ui/Action.tsx";

const TaskItem = (props: { task: Task }) => {
	const { task } = props;
	const { tr } = useI18n<I18n, "en">();
	const [showDetails, setShowDetails] = useState(false);
	const taskApi = useClient<TaskApi>();
	const alepha = useAlepha();

	const stars: ReactNode[] = [];
	for (let i = 0; i < 5; i++) {
		stars.push(
			<Icon key={i} icon={task.complexity > i ? "star" : "star-empty"} />,
		);
	}

	return (
		<Flex bordered card col>
			<Flex
				card
				gap2
				fill
				onClick={() => {
					setShowDetails(!showDetails);
				}}
			>
				<Action
					icon={showDetails ? "chevron-up" : "chevron-down"}
					variant={"minimal"}
					onClick={() => {
						setShowDetails(!showDetails);
					}}
				/>
				<Flex center style={{ width: 48 }}>
					<Tag minimal round>
						<Text uppercase>{task.priority}</Text>
					</Tag>
				</Flex>
				<Flex center>{stars}</Flex>
				<Flex center col style={{ width: 128 }}>
					<Text bold>{task.package}</Text>
				</Flex>
				<Flex
					fill
					col
					centerY
					style={{
						overflow: "hidden",
					}}
				>
					<Text>{task.title}</Text>
				</Flex>
				<Flex center div={{ onClick: (e) => e.stopPropagation() }}>
					<Action
						icon={"tick"}
						variant={"minimal"}
						intent={"success"}
						title={"Validate Task"}
						disabled={!taskApi.deleteTask.can()}
						onClick={async () => {
							await taskApi.deleteTask({
								params: { id: task.id },
							});
							alepha.state(
								"tasks",
								(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
							);
						}}
					/>
					<Action
						disabled={!taskApi.deleteTask.can()}
						icon={"cross"}
						variant={"minimal"}
						intent={"danger"}
						title={"Delete Task"}
						onClick={async () => {
							await taskApi.deleteTask({
								params: { id: task.id },
							});
							alepha.state(
								"tasks",
								(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
							);
						}}
					/>
				</Flex>
			</Flex>
			<Collapse isOpen={showDetails}>
				<Flex pad1 col>
					<Flex bordered bg rounded pad2 col center>
						<Text muted italic>
							{task.description}
						</Text>
					</Flex>
					<Flex>
						<Flex fill />
						<Text small muted>
							{tr("roadmap.item.createdAt", [
								task.createdAt.slice(0, 10),
								task.createdAt.slice(11, 16),
							])}
						</Text>
					</Flex>
				</Flex>
			</Collapse>
		</Flex>
	);
};

export default TaskItem;
