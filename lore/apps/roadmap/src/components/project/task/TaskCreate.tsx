import { TypeBoxError, t } from "@alepha/core";
import { useAlepha, useClient, useInject, useRouter } from "@alepha/react";
import { Flex, Grid } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { FormGroup, SegmentedControl } from "@blueprintjs/core";
import { AreaOfInterest, FloppyDisk, Plus, Tag } from "@blueprintjs/icons";
import { useState } from "react";
import type { AppRouter } from "../../../AppRouter.ts";
import type { Project, Task } from "../../../api/providers/Db.ts";
import type { TaskApi } from "../../../api/TaskApi.ts";
import { taskCreateSchema } from "../../../schemas/taskCreateSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import { Toaster } from "../../../services/Toaster.ts";
import Action from "../../shared/Action.tsx";
import Control from "../../shared/Control.tsx";
import TextEditor from "../../shared/TextEditor.tsx";

export interface TaskCreateProps {
	onSubmit: (task: Task) => void;
	task?: Task;
	project: Project;
}

const TaskCreate = (props: TaskCreateProps) => {
	const [error, setError] = useState<TypeBoxError | undefined>();
	const taskApi = useClient<TaskApi>();
	const alepha = useAlepha();
	const toaster = useInject(Toaster);
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
		onError: (err) => {
			toaster.show(err.message, "danger");

			if (err instanceof TypeBoxError) {
				setError(err);
				document
					.getElementById(`add-task${err.value.path.replaceAll("/", "-")}`)
					?.focus();
			}
		},
		onChange: (key) => {
			if (error?.value.path === key) {
				setError(undefined);
			}
		},
	});

	return (
		<Flex card col gap1 pad4 rounded bordered>
			<Flex fill style={{ maxWidth: 640 }}>
				<Flex form={{ onSubmit: form.onSubmit }} fill>
					<Flex col fill gap4>
						<Grid md={2} gap2>
							<Control
								fill
								inputField={form.input.title}
								error={error}
								inputGroupProps={{
									autoFocus: true,
									leftElement: <Tag />,
								}}
								formGroupProps={{
									label: tr("task.create.title"),
									helperText: tr("task.create.title.helper"),
								}}
							/>
							<Control
								fill
								inputField={form.input.package}
								inputGroupProps={{
									leftElement: <AreaOfInterest />,
								}}
								formGroupProps={{
									label: tr("task.create.package"),
									helperText: tr("task.create.package.helper"),
								}}
							/>
						</Grid>

						<FormGroup
							fill
							label={tr("task.create.description")}
							labelFor={form.input.description.props.id}
							helperText={tr("task.create.description.helper")}
						>
							<TextEditor {...form.input.description.props} />
						</FormGroup>

						<Grid gap2>
							<FormGroup
								label={tr("task.create.priority")}
								helperText={tr("task.create.priority.helper")}
							>
								<Flex>
									<Flex shadow bordered>
										<SegmentedControl
											defaultValue={
												props.task?.priority
													? String(props.task.priority)
													: undefined
											}
											onValueChange={(data) => {
												form.input.priority.set(data);
											}}
											options={[
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
											]}
										/>
									</Flex>
								</Flex>
							</FormGroup>
							<FormGroup
								label={tr("task.create.complexity")}
								helperText={tr("task.create.complexity.helper")}
							>
								<Flex>
									<Flex shadow bordered>
										<SegmentedControl
											defaultValue={
												props.task?.complexity
													? String(props.task.complexity)
													: undefined
											}
											onValueChange={(data) => {
												form.input.complexity.set(data);
											}}
											options={[
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
											]}
										/>
									</Flex>
								</Flex>
							</FormGroup>
						</Grid>

						<Flex fill />

						<Flex>
							{props.task ? (
								<Action
									type="submit"
									variant={"solid"}
									icon={<FloppyDisk />}
									size={"large"}
									intent={"primary"}
								>
									Update Quest
								</Action>
							) : (
								<Action
									type="submit"
									variant={"solid"}
									icon={<Plus />}
									size={"large"}
									intent={"success"}
								>
									{tr("task.create.submit")}
								</Action>
							)}
						</Flex>
					</Flex>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default TaskCreate;
