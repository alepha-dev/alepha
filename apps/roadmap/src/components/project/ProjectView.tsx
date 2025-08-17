import { NestedView, useRouterState } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import ExperienceBar from "../shared/ExperienceBar.tsx";
import ProjectActions from "./ProjectActions.tsx";
import QuestLog from "./QuestLog.tsx";

const ProjectView = () => {
	return (
		<Flex fill col overflow>
			<Flex
				fill
				overflow
				bg
				bordered
				style={{
					borderLeft: 0,
					borderRight: 0,
				}}
			>
				<Flex fill visible={"md"}>
					<Flex pad1 fill style={{ paddingRight: 0 }}>
						<QuestLog />
					</Flex>
				</Flex>
				<Flex className={"container"} col overflow>
					<Flex pad1 hide={"md"} wFill>
						<ProjectActions />
					</Flex>
					<NestedView />
				</Flex>
				<Flex
					fill
					visible={"xl"}
					style={{
						width: 300,
						height: "100%",
					}}
				>
					<History />
				</Flex>
			</Flex>
			<ExperienceBar />
		</Flex>
	);
};

export default ProjectView;

const History = () => {
	const router = useRouterState();
	console.log(router);
	if (!router.params.taskId) {
		return;
	}
	// transform css 3D scale
	return (
		<Flex fill pad1 style={{ paddingLeft: 0, perspective: 1000 }}>
			<Flex fill center>
				<Text small muted>
					Quest History
				</Text>
			</Flex>
		</Flex>
	);
};
