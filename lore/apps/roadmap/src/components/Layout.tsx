import { NestedView, useStore } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { BlueprintProvider } from "@blueprintjs/core";
import type { Task } from "../providers/Db.ts";
import QuestLog from "./home/QuestLog.tsx";
import ExperienceBar from "./shared/ExperienceBar.tsx";
import Header from "./shared/Header.tsx";

export interface HomeProps {
	tasks: Task[];
}

declare module "@alepha/core" {
	interface State {
		tasks?: Task[];
	}
}

const Layout = (props: HomeProps) => {
	const [tasks = []] = useStore("tasks", props.tasks);

	return (
		<BlueprintProvider>
			<Flex col layout>
				<Header tasks={tasks} />
				<Flex fill bg overflow>
					<Flex fill visible={"md"}>
						<Flex pad1 fill>
							<QuestLog tasks={tasks} />
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
		</BlueprintProvider>
	);
};

export default Layout;
