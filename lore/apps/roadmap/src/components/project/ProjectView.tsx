import { NestedView } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import QuestLog from "../home/QuestLog.tsx";
import ExperienceBar from "../shared/ExperienceBar.tsx";

const ProjectView = () => {
	return (
		<Flex fill col overflow>
			<Flex fill bg overflow>
				<Flex fill visible={"md"}>
					<Flex pad1 fill>
						<QuestLog />
					</Flex>
				</Flex>
				<Flex col className={"container"}>
					<NestedView />
				</Flex>
				<Flex
					fill
					visible={"md"}
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
