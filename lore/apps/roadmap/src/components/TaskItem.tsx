import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Collapse, Icon, Tag } from "@blueprintjs/core";
import { type ReactNode, useState } from "react";
import type { I18n } from "../services/I18n.ts";
import Action from "./ui/Action.tsx";

export interface Task {
	id: number;
	title: string;
	description: string;
	started: boolean;
	package: string;
	level: number;
	createdAt: Date;
	priority: "optional" | "low" | "medium" | "high";
}

const TaskItem = (props: { task: Task }) => {
	const { task } = props;
	const { tr } = useI18n<I18n, "en">();
	const [showDetails, setShowDetails] = useState(false);

	const stars: ReactNode[] = [];
	for (let i = 0; i < 5; i++) {
		stars.push(<Icon key={i} icon={task.level > i ? "star" : "star-empty"} />);
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
					/>
					<Action
						icon={"edit"}
						variant={"minimal"}
						intent={"none"}
						title={"Edit Task"}
					/>
					<Action
						icon={"cross"}
						variant={"minimal"}
						intent={"danger"}
						title={"Delete Task"}
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
								task.createdAt.toISOString().slice(0, 10),
								task.createdAt.toISOString().slice(11, 19),
							])}
						</Text>
					</Flex>
				</Flex>
			</Collapse>
		</Flex>
	);
};

export default TaskItem;
