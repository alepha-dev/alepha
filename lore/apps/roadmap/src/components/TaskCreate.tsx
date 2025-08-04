import type { TypeBoxError } from "@alepha/core";
import { useAlepha, useClient, useSchema } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { Button, FormGroup, Icon, TextArea } from "@blueprintjs/core";
import { useState } from "react";
import type TaskApi from "../api/TaskApi.ts";
import type { I18n } from "../services/I18n.ts";
import Control from "./ui/Control";

export interface TaskCreateProps {
	onSubmit: () => void;
}

const TaskCreate = (props: TaskCreateProps) => {
	const { tr } = useI18n<I18n, "en">();
	const [error, setError] = useState<TypeBoxError | undefined>();
	const taskApi = useClient<TaskApi>();
	const alepha = useAlepha();
	const schema = useSchema(taskApi.createTask);

	const form = useForm({
		id: "add-task",
		schema: schema.body,
		handler: async (data) => {
			const resp = await taskApi.createTask({
				body: data,
			});

			alepha.state("tasks", [resp, ...(alepha.state("tasks") ?? [])]);

			props.onSubmit();
		},
		onError: (err) => {
			setError(err);
			document
				.getElementById(`add-task${err.value.path.replaceAll("/", "-")}`)
				?.focus();
		},
		onChange: (key) => {
			if (error?.value.path === key) {
				setError(undefined);
			}
		},
	});

	return (
		<Flex card fill col gap1 pad4 rounded bordered>
			<Flex fill>
				<form style={{ width: "512px" }} onSubmit={form.onSubmit}>
					<Flex gap1>
						<Control fill inputField={form.input.package} />
						<Control
							fill
							inputField={form.input.title}
							error={error}
							inputGroupProps={{
								leftElement: <Icon icon={"tag"} />,
							}}
						/>
					</Flex>

					<FormGroup fill label="Description" labelFor="text-input3">
						<TextArea
							fill
							{...form.input.description.props}
							id={"text-input3"}
							rows={10}
						/>
					</FormGroup>

					<Flex gap1>
						<Control fill inputField={form.input.priority} />
						<Control fill inputField={form.input.complexity} />
					</Flex>

					<Button
						type="submit"
						variant={"outlined"}
						icon={"cube-add"}
						size={"large"}
						intent={"success"}
					>
						Create Task
					</Button>
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
