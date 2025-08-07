import { NestedView } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import ExperienceBar from "../shared/ExperienceBar.tsx";
import ProjectActions from "./ProjectActions.tsx";
import QuestLog from "./QuestLog.tsx";

const ProjectView = () => {
	return (
		<Flex fill col overflow>
			<Flex fill bg overflow>
				<Flex fill visible={"md"}>
					<Flex pad1 fill>
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
				></Flex>
			</Flex>
			<ExperienceBar />
		</Flex>
	);
};

export default ProjectView;
