import { DateTimeProvider } from "@alepha/datetime";
import {
	useAlepha,
	useClient,
	useInject,
	useRouter,
	useStore,
} from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { Card, Drawer, Flex, Group, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
	IconCircleFilled,
	IconEdit,
	IconFileText,
	IconPigMoney,
	IconSwords,
	IconTag,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AppRouter } from "../../../AppRouter.ts";
import type { Task } from "../../../api/providers/Db.ts";
import type { TaskApi } from "../../../api/TaskApi.ts";
import { theme } from "../../../constants/theme.ts";
import { CharacterInfo } from "../../../services/CharacterInfo.ts";
import type { I18n } from "../../../services/I18n.ts";
import Action from "../../ui/Action.tsx";
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
	const level = useInject(CharacterInfo);
	const { tr } = useI18n<I18n, "en">();
	const [showDialog, setShowDialog] = useState(false);

	const [task, setTask] = useState<Task>(props.task);
	useEffect(() => {
		setTask(props.task);
	}, [props.task]);

	const [project] = useStore("project");
	if (!project) {
		return null;
	}

	const money = level.getMoneyFromTask(task);

	const openDeleteModal = () =>
		new Promise<boolean>((resolve) =>
			modals.openConfirmModal({
				title: "Abandon the quest",
				centered: true,
				children: (
					<Text size="sm">
						Are you sure you want to abandon this quest? You will lose all
						progress on this task.
					</Text>
				),
				onClose: () => resolve(false),
				labels: { confirm: "Abandon Quest", cancel: "Cancel" },
				confirmProps: { color: "red" },
				onCancel: () => resolve(false),
				onConfirm: () => resolve(true),
			}),
		);

	return (
		<Card
			key={task.id}
			flex={1}
			withBorder
			className={"shadow"}
			bg={theme.colors.card}
			p={0}
			m={2}
		>
			<Stack flex={1} className={"overflow-auto"} gap={0}>
				<Stack flex={1} className={"overflow-auto"} p={"xs"} gap={0}>
					<Flex justify={"end"}>
						<Action
							px={"xs"}
							href={router.path("projectBoard", {
								params: { projectId: String(project.id) },
							})}
						>
							<IconX size={theme.icon.size.md} />
						</Action>
					</Flex>

					<Flex
						px={"md"}
						direction={"column"}
						gap={"md"}
						flex={1}
						className={"overflow-auto"}
					>
						<Flex gap={"xs"} align="center" justify="center">
							<IconTag size={theme.icon.size.lg} />
							<Text
								size="lg"
								fw={"bold"}
								style={{ textWrap: "nowrap" }}
								className={"cinzel-400"}
							>
								{task.title}
							</Text>
							<EditTaskButton
								task={task}
								onUpdate={setTask}
								showDialog={showDialog}
								setShowDialog={setShowDialog}
							/>
							<Flex
								w={"100%"}
								style={{
									opacity: 0.1,
									height: 1,
									backgroundColor: "var(--text-color)",
								}}
							/>
						</Flex>
						<Text size={"sm"}>
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

						<Stack gap={0}>
							<Flex gap={"xs"} align="center" justify="center">
								<IconFileText size={theme.icon.size.lg} />
								<Text size="lg" fw={"bold"} className={"cinzel-400"}>
									{tr("task.view.description")}
								</Text>
								<Flex
									w={"100%"}
									style={{
										opacity: 0.1,
										height: 1,
										backgroundColor: "var(--text-color)",
									}}
								/>
							</Flex>
						</Stack>

						<TaskDescription task={task} onEdit={() => setShowDialog(true)} />

						<Flex gap={"xs"} align="center" justify="center">
							<IconPigMoney size={theme.icon.size.lg} />
							<Text className={"cinzel-400"} size="lg" fw={"bold"}>
								{tr("task.view.rewards")}
							</Text>
							<Flex
								w={"100%"}
								style={{
									opacity: 0.1,
									height: 1,
									backgroundColor: "var(--text-color)",
								}}
							/>
						</Flex>
						<Flex gap={"sm"}>
							<Text size={"sm"}>{tr("task.view.receive")}</Text>
							<Flex gap={"xs"} align={"center"}>
								<Flex align={"center"} gap={2}>
									<Text size={"sm"}>{level.getGold(money)}</Text>
									<IconCircleFilled
										color={"var(--color-gold)"}
										size={theme.icon.size.xs}
									/>
								</Flex>
								<Flex align={"center"} gap={2}>
									<Text size={"sm"}>{level.getSilver(money)}</Text>
									<IconCircleFilled
										color={"var(--color-silver)"}
										size={theme.icon.size.xs}
									/>
								</Flex>
							</Flex>
						</Flex>
						<Flex gap={"sm"}>
							<Text size={"sm"}>{tr("task.view.experience")}</Text>
							<Text size={"sm"} fw={"bold"}>
								{level.getXpFromTask(task)} XP
							</Text>
						</Flex>
					</Flex>

					<Flex px={1}>
						<Flex flex={1} />
						<Flex>
							<Text size="sm" c={"dimmed"}>
								{tr("task.view.created")} {dt.of(task.createdAt).fromNow()}
							</Text>
						</Flex>
					</Flex>
				</Stack>

				<Flex p={"xs"}>
					<Card
						w={"100%"}
						p={"xs"}
						bg={theme.colors.panel}
						withBorder
						radius={"md"}
						className={"shadow"}
					>
						<Flex justify={"space-between"}>
							<Action
								c={"red"}
								variant={"subtle"}
								leftSection={<IconTrash size={theme.icon.size.md} />}
								disabled={!taskApi.deleteTask.can()}
								onClick={async () => {
									const confirm = await openDeleteModal();
									if (!confirm) {
										return;
									}

									await taskApi.deleteTask({
										params: { id: task.id },
									});

									alepha.state(
										"tasks",
										(alepha.state("tasks") ?? []).filter(
											(t) => t.id !== task.id,
										),
									);
									await router.go("projectBoard", {
										meta: {
											deleted: true,
										},
									});
								}}
							>
								{tr("task.view.actions.abandon")}
							</Action>
							<Action
								c={"green"}
								variant={"subtle"}
								leftSection={<IconSwords size={theme.icon.size.md} />}
								disabled={!taskApi.deleteTask.can()}
								onClick={async () => {
									const { character } = await taskApi.completeTask({
										params: { id: task.id },
									});
									alepha.state("character", character);
									alepha.state(
										"tasks",
										(alepha.state("tasks") ?? []).filter(
											(t) => t.id !== task.id,
										),
									);
									await router.go("projectBoard", {
										meta: {
											completed: true,
										},
									});
								}}
							>
								{tr("task.view.actions.complete")}
							</Action>
						</Flex>
					</Card>
				</Flex>
			</Stack>
		</Card>
	);
};

export default TaskView;

const EditTaskButton = (props: {
	task: Task;
	onUpdate: (task: Task) => void;
	setShowDialog?: (show: boolean) => void;
	showDialog?: boolean;
}) => {
	const { showDialog = false, setShowDialog = () => {} } = props;

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
				px={"xs"}
				variant={"subtle"}
				onClick={() => {
					setShowDialog(true);
				}}
			>
				<IconEdit size={theme.icon.size.md} />
			</Action>
			<Drawer
				title={"Update Quest"}
				size={"xl"}
				position={"right"}
				opened={showDialog}
				onClose={() => setShowDialog(false)}
				className={"drawer"}
			>
				<Card
					withBorder
					bg={theme.colors.card}
					radius={"md"}
					className={"shadow"}
				>
					<TaskCreate
						project={project}
						task={props.task}
						onSubmit={(task) => {
							setShowDialog(false);
							props.onUpdate(task);
						}}
					/>
				</Card>
			</Drawer>
		</Flex>
	);
};
