import { DateTimeProvider } from "@alepha/datetime";
import { useAlepha, useClient, useInject, useRouter } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { Button, Divider, Drawer, Icon } from "@blueprintjs/core";
import { useState } from "react";
import type TaskApi from "../../api/TaskApi.ts";
import type { Task } from "../../providers/Db.ts";
import Action from "../shared/Action.tsx";
import TaskCreate from "./TaskCreate.tsx";

export interface TaskViewProps {
	task: Task;
}

const TaskView = (props: TaskViewProps) => {
	const dt = useInject(DateTimeProvider);
	const alepha = useAlepha();
	const taskApi = useClient<TaskApi>();
	const router = useRouter();
	const [task, setTask] = useState<Task>(props.task);

	return (
		<Flex fill pad2 col>
			<Flex card pad1 fill gap3 col shadow bordered>
				<Flex overflow fill col>
					<Flex>
						<Flex fill />
						<Flex>
							<Text small muted>
								created {dt.of(task.createdAt).fromNow()}
							</Text>
						</Flex>
					</Flex>
					<Flex pad3 col gap3 fill overflow>
						<Flex gap1 centerX>
							<Icon icon={"tag"} />
							<Text large bold>
								{task.title}
							</Text>
							<EditTaskButton task={task} onUpdate={setTask} />
						</Flex>
						<Text>
							This quest is on a <Text italic> {task.priority}</Text> priority
							level. Complexity is{" "}
							<Text bold>
								{task.complexity === 5
									? "S"
									: task.complexity === 4
										? "A"
										: task.complexity === 3
											? "B"
											: task.complexity === 2
												? "C"
												: "F"}
							</Text>{" "}
							tier.
						</Text>

						<Flex gap1 centerX>
							<Icon icon={"manually-entered-data"} />
							<Text large bold>
								Description
							</Text>
						</Flex>
						<Flex shadow overflow bordered pad1 pad2h rounded>
							<pre>{task.description}</pre>
						</Flex>

						<Flex gap1 centerX>
							<Icon icon={"bank-account"} />
							<Text large bold>
								Rewards
							</Text>
						</Flex>
						<Flex gap2>
							<Text>You will receive:</Text>
							<Flex gap1>
								<Flex>
									{task.complexity * 1}{" "}
									<Icon icon={"symbol-circle"} color={"#db9b05"} />
								</Flex>
								<Flex>
									{task.complexity * 10}{" "}
									<Icon icon={"symbol-circle"} color={"rgb(185,182,182)"} />
								</Flex>
							</Flex>
						</Flex>

						<Flex gap2>
							<Text>Experience:</Text>
							<Text bold>{task.complexity * 150} XP</Text>
						</Flex>
					</Flex>
				</Flex>
				<Flex col>
					<Flex pad1 card shadow bg bordered wFill rounded>
						<Action
							variant={"minimal"}
							intent={"success"}
							icon={"tick"}
							text={"Mark As Complete"}
							onClick={async () => {
								await taskApi.deleteTask({
									params: { id: task.id },
								});
								alepha.state(
									"tasks",
									(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
								);
								await router.go("/");
							}}
						/>
						<Divider />
						<Flex fill />
						<Action
							variant={"minimal"}
							icon={"cross"}
							text={"Abandon Quest"}
							intent={"danger"}
							onClick={async () => {
								await taskApi.deleteTask({
									params: { id: task.id },
								});
								alepha.state(
									"tasks",
									(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
								);
								await router.go("/");
							}}
						/>
					</Flex>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default TaskView;

const EditTaskButton = (props: {
	task: Task;
	onUpdate: (task: Task) => void;
}) => {
	const [showDialog, setShowDialog] = useState(false);
	const client = useClient<TaskApi>();

	if (!client.updateTaskById.can()) {
		return null;
	}

	return (
		<Flex>
			<Action
				variant={"minimal"}
				icon={"edit"}
				onClick={() => {
					setShowDialog(true);
				}}
			/>
			<Drawer
				isOpen={showDialog}
				onClose={() => setShowDialog(false)}
				className={"drawer"}
			>
				<Flex bg col bordered fill pad2>
					<Flex col style={{ height: 48 }}>
						<Flex>
							<Flex fill></Flex>
							<Flex>
								<Button
									variant={"minimal"}
									icon={"cross"}
									onClick={() => setShowDialog(false)}
								/>
							</Flex>
						</Flex>
					</Flex>
					<Flex pad2h>
						<Flex
							pad1
							card
							bordered
							wFill
							rounded
							style={{
								borderBottomLeftRadius: 0,
								borderBottomRightRadius: 0,
								borderBottom: 0,
							}}
						/>
					</Flex>
					<TaskCreate
						task={props.task}
						onSubmit={(task) => {
							setShowDialog(false);
							props.onUpdate(task);
						}}
					/>
				</Flex>
			</Drawer>
		</Flex>
	);
};
