import { TypeBoxError } from "@alepha/core";
import {
	useAlepha,
	useClient,
	useInject,
	useRouter,
	useSchema,
} from "@alepha/react";
import { Flex, Grid, Text } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { FormGroup, Icon, SegmentedControl, TextArea } from "@blueprintjs/core";
import { useState } from "react";
import type { AppRouter } from "../../../AppRouter.ts";
import type TaskApi from "../../../api/TaskApi.ts";
import type { Project, Task } from "../../../providers/Db.ts";
import type { I18n } from "../../../services/I18n.ts";
import Toast from "../../../services/Toast.ts";
import Action from "../../shared/Action.tsx";
import Control from "../../shared/Control.tsx";

export interface TaskCreateProps {
	onSubmit: (task: Task) => void;
	task?: Task;
	project: Project;
}

const TaskCreate = (props: TaskCreateProps) => {
	const [error, setError] = useState<TypeBoxError | undefined>();
	const taskApi = useClient<TaskApi>();
	const alepha = useAlepha();
	const toast = useInject(Toast);
	const schema = useSchema(taskApi.createTask);
	const router = useRouter<AppRouter>();
	const { tr } = useI18n<I18n, "en">();

	const form = useForm({
		id: "add-task",
		schema: schema.body,
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
			if (err instanceof TypeBoxError) {
				setError(err);
				document
					.getElementById(`add-task${err.value.path.replaceAll("/", "-")}`)
					?.focus();
			} else {
				toast.show(err.message, "danger");
			}
		},
		onChange: (key) => {
			if (error?.value.path === key) {
				setError(undefined);
			}
		},
	});

	return (
		<Flex card fill col gap1 pad4 rounded bordered>
			<Flex fill style={{ maxWidth: 640 }}>
				<form style={{ display: "flex", flex: 1 }} onSubmit={form.onSubmit}>
					<Flex col fill gap1>
						<Grid md={2} gap2>
							<Control
								fill
								inputField={form.input.title}
								error={error}
								inputGroupProps={{
									autoFocus: true,
									leftElement: <Icon icon={"tag"} />,
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
									leftElement: <Icon icon={"area-of-interest"} />,
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
							labelFor="text-input3"
							helperText={tr("task.create.description.helper")}
						>
							<TextArea
								style={{ resize: "none" }}
								rows={16}
								fill
								{...form.input.description.props}
								id={"text-input3"}
							/>
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
									icon={"floppy-disk"}
									size={"large"}
									intent={"primary"}
								>
									Update Quest
								</Action>
							) : (
								<Action
									type="submit"
									variant={"solid"}
									icon={"plus"}
									size={"large"}
									intent={"success"}
								>
									{tr("task.create.submit")}
								</Action>
							)}
						</Flex>
					</Flex>
				</form>
			</Flex>
			<Flex>
				<Flex fill></Flex>
				<Flex></Flex>
			</Flex>
		</Flex>
	);
};

export default TaskCreate;
