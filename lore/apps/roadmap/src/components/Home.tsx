import { Flex } from "@alepha/react-flex";
import { BlueprintProvider, Button } from "@blueprintjs/core";
import Header from "./Header.tsx";
import type { Task } from "./TaskItem.tsx";
import TaskItem from "./TaskItem.tsx";

const tasks: Task[] = [
	{
		id: 1,
		package: "Roadmap",
		title: "Deploy to Vercel",
		description:
			"Deploy the roadmap application to Vercel for public access. Editing roadmap via internet is a must-have feature.",
		started: false,
		level: 2,
		createdAt: new Date("2023-10-01T12:00:00Z"),
		priority: "high",
	},
	{
		id: 2,
		package: "React Head",
		title: "useHead()",
		description:
			"Implement useHead() hook to manage document head in React applications. This will allow dynamic updates to the document title and meta tags.",
		started: false,
		level: 3,
		createdAt: new Date("2023-10-02T12:00:00Z"),
		priority: "low",
	},
];

const Home = () => {
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
							<Button variant={"minimal"} icon={"export"} size={"large"} />
							<Button variant={"minimal"} icon={"input"} size={"large"} />
							<Button variant={"minimal"} icon={"menu"} size={"large"} />
						</Flex>
					</Flex>
					<Flex pad1 col style={{ width: 1000, height: "100%" }}>
						{tasks.map((task) => (
							<TaskItem task={task} key={task.id} />
						))}
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
