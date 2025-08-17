import { t } from "@alepha/core";
import { useAlepha, useClient } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { FormState, useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { FloppyDisk } from "@blueprintjs/icons";
import type { ProjectApi } from "../../api/ProjectApi.ts";
import type { Project } from "../../api/providers/Db.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";
import Control from "../shared/Control.tsx";

export interface ProjectUpdateProps {
	project: Project;
}

const ProjectUpdate = (props: ProjectUpdateProps) => {
	const projectApi = useClient<ProjectApi>();
	const alepha = useAlepha();
	const { tr } = useI18n<I18n, "en">();

	const form = useForm({
		initialValues: props.project,
		schema: t.object({
			title: t.optional(t.string()),
			public: t.optional(t.boolean()),
		}),
		handler: async (values) => {
			const project = await projectApi.updateProjectById({
				params: { id: props.project.id },
				body: values,
			});

			alepha.state("project", project);
			alepha.state("user.projects", [
				...(alepha.state("user.projects") ?? []).filter(
					(p) => p.id !== project.id,
				),
				project,
			]);
		},
	});

	return (
		<Flex shadow pad2 bordered card col gap4 form={{ onSubmit: form.onSubmit }}>
			<Flex>
				<Control
					formGroupProps={{
						label: tr("project.create.name"),
					}}
					inputGroupProps={{
						leftIcon: "tag",
					}}
					inputField={form.input.title}
				/>
			</Flex>
			<Control
				inputField={form.input.public}
				formGroupProps={{
					helperText: tr("project.create.public.helper"),
				}}
			/>
			<Flex>
				<FormState form={form}>
					{({ loading, dirty }) => (
						<Action
							icon={<FloppyDisk />}
							type="submit"
							loading={loading}
							disabled={loading || !dirty}
						>
							{tr("project.update.submit")}
						</Action>
					)}
				</FormState>
			</Flex>
		</Flex>
	);
};

export default ProjectUpdate;
