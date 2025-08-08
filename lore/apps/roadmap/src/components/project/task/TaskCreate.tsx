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
import { FormGroup, Icon, SegmentedControl, TextArea } from "@blueprintjs/core";
import { useState } from "react";
import type { AppRouter } from "../../../AppRouter.ts";
import type TaskApi from "../../../api/TaskApi.ts";
import type { Project, Task } from "../../../providers/Db.ts";
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
			<Flex fill style={{ maxWidth: 512 }}>
				<form style={{ display: "flex", flex: 1 }} onSubmit={form.onSubmit}>
					<Flex col fill gap1>
						<Grid md={2} gap2>
							<Control
								fill
								inputField={form.input.package}
								inputGroupProps={{
									autoFocus: true,
									leftElement: <Icon icon={"package"} />,
								}}
							/>
							<Control
								fill
								inputField={form.input.title}
								error={error}
								inputGroupProps={{
									leftElement: <Icon icon={"tag"} />,
								}}
							/>
						</Grid>

						<FormGroup fill label="Description" labelFor="text-input3">
							<TextArea
								style={{ resize: "none" }}
								rows={16}
								fill
								{...form.input.description.props}
								id={"text-input3"}
							/>
						</FormGroup>

						<Grid gap2>
							<Flex fill>
								<Flex col>
									<Text style={{ marginBottom: 5 }}>Priority</Text>{" "}
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
													label: "High",
													value: "high",
												},
												{
													label: "Normal",
													value: "medium",
												},
												{
													label: "Low",
													value: "low",
												},
												{
													label: "None",
													value: "optional",
												},
											]}
										/>
									</Flex>
									<Flex pad1 />
								</Flex>
							</Flex>
							<Flex fill>
								<Flex col>
									<Text style={{ marginBottom: 5 }}>Complexity</Text>
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
							</Flex>
							<Flex pad1 />
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
									Add Quest To Roadmap
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
