import { DateTimeProvider } from "@alepha/datetime";
import {
	useAlepha,
	useClient,
	useInject,
	useRouter,
	useStore,
} from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button, Divider, Drawer, Icon } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import type { AppRouter } from "../../../AppRouter.ts";
import type TaskApi from "../../../api/TaskApi.ts";
import type { Task } from "../../../providers/Db.ts";
import type { I18n } from "../../../services/I18n.ts";
import { Level } from "../../../services/Level.ts";
import Action from "../../shared/Action.tsx";
import TaskCreate from "./TaskCreate.tsx";
import TaskDescription from "./TaskDescription.tsx";

export interface TaskViewProps {
	task: Task;
}

const TaskView = (props: TaskViewProps) => {
	const dt = useInject(DateTimeProvider);
	const alepha = useAlepha();
	const taskApi = useClient<TaskApi>();
	const router = useRouter<AppRouter>();
	const level = useInject(Level);
	const { tr } = useI18n<I18n, "en">();

	const [task, setTask] = useState<Task>(props.task);
	useEffect(() => {
		setTask(props.task);
	}, [props.task]);

	const [project] = useStore("project");
	if (!project) {
		return null;
	}

	return (
		<Flex fill pad1 col>
			<Flex card pad1 fill gap3 col shadow bordered>
				<Flex overflow fill col>
					<Flex>
						<Flex fill />
						<Flex>
							<Action
								href={router.path("projectBoard", {
									params: { projectId: String(project.id) },
								})}
								icon={"cross"}
								size={"small"}
								variant={"minimal"}
							/>
						</Flex>
					</Flex>

					<Flex pad3 col gap3 fill overflow>
						<Flex gap1 centerX>
							<Icon icon={"tag"} />
							<Text large bold style={{ textWrap: "nowrap" }}>
								{task.title}
							</Text>
							<EditTaskButton task={task} onUpdate={setTask} />
							<Flex
								wFill
								style={{
									opacity: 0.1,
									height: 1,
									backgroundColor: "var(--text-color)",
								}}
							/>
						</Flex>
						<Text>
							{tr("task.view.summary", [
								task.priority,
								task.complexity === 5
									? "S"
									: task.complexity === 4
										? "A"
										: task.complexity === 3
											? "B"
											: task.complexity === 2
												? "C"
												: "F",
							])}
						</Text>

						<Flex col>
							<Flex gap1 centerX>
								<Icon icon={"manually-entered-data"} />
								<Text large bold>
									{tr("task.view.description")}
								</Text>
								<Flex
									wFill
									style={{
										opacity: 0.1,
										height: 1,
										backgroundColor: "var(--text-color)",
									}}
								/>
							</Flex>
						</Flex>
						<TaskDescription task={task} />
						<Flex gap1 centerX>
							<Icon icon={"bank-account"} />
							<Text large bold>
								{tr("task.view.rewards")}
							</Text>
							<Flex
								wFill
								style={{
									opacity: 0.1,
									height: 1,
									backgroundColor: "var(--text-color)",
								}}
							/>
						</Flex>
						<Flex gap2>
							<Text>{tr("task.view.receive")}</Text>
							<Flex gap1>
								<Flex>
									{task.complexity * 1}{" "}
									<Icon icon={"symbol-circle"} color={"var(--color-gold)"} />
								</Flex>
								<Flex>
									{task.complexity * 10}{" "}
									<Icon icon={"symbol-circle"} color={"var(--color-silver)"} />
								</Flex>
							</Flex>
						</Flex>

						<Flex gap2>
							<Text>{tr("task.view.experience")}</Text>
							<Text bold>{level.getXpFromTask(task)} XP</Text>
						</Flex>
					</Flex>

					<Flex pad1h>
						<Flex fill />
						<Flex>
							<Text small muted>
								{tr("task.view.created")} {dt.of(task.createdAt).fromNow()}
							</Text>
						</Flex>
					</Flex>
				</Flex>
				<Flex col>
					<Flex pad1 card shadow bg bordered wFill rounded>
						<Action
							variant={"minimal"}
							intent={"success"}
							icon={"tick"}
							text={tr("task.view.actions.complete")}
							disabled={!taskApi.deleteTask.can()}
							onClick={async () => {
								const { character } = await taskApi.completeTask({
									params: { id: task.id },
								});
								alepha.state("character", character);
								alepha.state(
									"tasks",
									(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
								);
								await router.go("projectBoard");
							}}
						/>
						<Divider />
						<Flex fill />
						<Action
							variant={"minimal"}
							icon={"cross"}
							text={tr("task.view.actions.abandon")}
							intent={"danger"}
							disabled={!taskApi.deleteTask.can()}
							onClick={async () => {
								await taskApi.deleteTask({
									params: { id: task.id },
								});
								alepha.state(
									"tasks",
									(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
								);
								await router.go("projectBoard");
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
	const [project] = useStore("project");
	if (!project) {
		return null;
	}

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
						project={project}
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
