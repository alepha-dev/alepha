import { t } from "@alepha/core";
import { useAlepha, useClient, useRouter } from "@alepha/react";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { Flex, SimpleGrid, Space, Stack } from "@mantine/core";
import {
	IconDeviceFloppy,
	IconFileText,
	IconPlus,
	IconTag,
	IconTent,
} from "@tabler/icons-react";
import type { AppRouter } from "../../../AppRouter.ts";
import type { Project, Task } from "../../../api/providers/Db.ts";
import type { TaskApi } from "../../../api/TaskApi.ts";
import { taskCreateSchema } from "../../../schemas/taskCreateSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import TextEditor from "../../shared/TextEditor.tsx";
import Action from "../../ui/Action.tsx";
import Control from "../../ui/Control.tsx";

export interface TaskCreateProps {
	onSubmit: (task: Task) => void;
	task?: Task;
	project: Project;
}

const TaskCreate = (props: TaskCreateProps) => {
	const taskApi = useClient<TaskApi>();
	const alepha = useAlepha();
	const router = useRouter<AppRouter>();
	const { tr } = useI18n<I18n, "en">();

	const form = useForm({
		id: "task-create",
		schema: t.omit(taskCreateSchema, ["projectId"]),
		initialValues: props.task,
		handler: async (data) => {
			if (props.task) {
				const resp = await taskApi.updateTaskById({
					params: { id: props.task.id },
					body: data,
				});
				alepha.state("tasks", [
					resp,
					...(alepha.state("tasks") ?? []).filter(
						(task) => task.id !== resp.id,
					),
				]);
				props.onSubmit(resp);
				return;
			}

			const task = await taskApi.createTask({
				body: {
					...data,
					projectId: props.project.id,
				},
			});

			alepha.state("tasks", [task, ...(alepha.state("tasks") ?? [])]);
			props.onSubmit(task);

			await router.go("projectTask", {
				params: {
					projectId: String(props.project.id),
					taskId: String(task.id),
				},
			});
		},
	});

	return (
		<form onSubmit={form.onSubmit} noValidate>
			<Stack>
				<SimpleGrid
					cols={{
						base: 1,
						md: 2,
					}}
					spacing={"sm"}
				>
					<Control
						title={tr("task.create.title")}
						description={tr("task.create.title.helper")}
						input={form.input.title}
						icon={<IconTag />}
					/>
					<Control
						title={tr("task.create.package")}
						description={tr("task.create.package.helper")}
						input={form.input.package}
						icon={<IconTent />}
					/>
				</SimpleGrid>

				<Control
					description={tr("task.create.description.helper")}
					title={tr("task.create.description")}
					custom={TextEditor}
					input={form.input.description}
					icon={<IconFileText />}
				/>

				<SimpleGrid
					cols={{
						base: 1,
						md: 2,
					}}
					spacing={"sm"}
				>
					<Control
						input={form.input.priority}
						title={tr("task.create.priority")}
						description={tr("task.create.priority.helper")}
						segmented={{
							data: [
								{
									label: tr("priority.high"),
									value: "high",
								},
								{
									label: tr("priority.medium"),
									value: "medium",
								},
								{
									label: tr("priority.low"),
									value: "low",
								},
								{
									label: tr("priority.none"),
									value: "optional",
								},
							],
						}}
					/>
					<Control
						input={form.input.complexity}
						title={tr("task.create.complexity")}
						description={tr("task.create.complexity.helper")}
						segmented={{
							data: [
								{
									label: "S",
									value: "5",
								},
								{
									label: "A",
									value: "4",
								},
								{
									label: "B",
									value: "3",
								},
								{
									label: "C",
									value: "2",
								},
								{
									label: "F",
									value: "1",
								},
							],
						}}
					/>
				</SimpleGrid>

				<Space />

				<Flex>
					{props.task ? (
						<Action
							variant={"filled"}
							color={"blue"}
							form={form}
							leftSection={<IconDeviceFloppy />}
						>
							Update Quest
						</Action>
					) : (
						<Action
							variant={"filled"}
							color={"green"}
							form={form}
							leftSection={<IconPlus />}
						>
							{tr("task.create.submit")}
						</Action>
					)}
				</Flex>
			</Stack>
		</form>
	);
};

export default TaskCreate;
