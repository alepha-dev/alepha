import { NestedView, useStore } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { BlueprintProvider } from "@blueprintjs/core";
import type { Task } from "../providers/Db.ts";
import QuestLog from "./home/QuestLog.tsx";
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
				<Header />
				<Flex fill bg overflow>
					<Flex fill>
						<Flex pad1 fill>
							<QuestLog tasks={tasks} />
						</Flex>
					</Flex>
					<Flex pad1 col style={{ width: 1000, height: "100%" }}>
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
				<Flex pad1 bordered />
			</Flex>
		</BlueprintProvider>
	);
};

export default Layout;
