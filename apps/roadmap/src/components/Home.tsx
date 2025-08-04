import { useStore } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { BlueprintProvider, Button } from "@blueprintjs/core";
import type { Task } from "../providers/Db.ts";
import Header from "./Header.tsx";
import TaskList from "./TaskList.tsx";

export interface HomeProps {
	tasks: Task[];
}

declare module "@alepha/core" {
	interface State {
		tasks?: Task[];
	}
}

const Home = (props: HomeProps) => {
	const [tasks = []] = useStore("tasks", props.tasks);

	return (
		<BlueprintProvider>
			<Flex col layout>
				<Header />
				<Flex fill center bg>
					<Flex
						card
						fill
						bordered
						style={{
							position: "relative",
							width: 300,
							borderTop: 0,
							borderBottom: 0,
						}}
					>
						<Flex fill></Flex>
						<Flex pad2 col>
							<Button variant={"minimal"} icon={"glass"} size={"large"} />
							<Button variant={"minimal"} icon={"shield"} size={"large"} />
							<Button variant={"minimal"} icon={"range-ring"} size={"large"} />
						</Flex>
					</Flex>
					<Flex pad1 col style={{ width: 1000, height: "100%" }}>
						<TaskList tasks={tasks} />
					</Flex>
					<Flex
						fill
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

export default Home;
