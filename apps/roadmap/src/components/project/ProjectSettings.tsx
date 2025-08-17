import { useAlepha, useClient, useRouter, useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import type { AppRouter } from "../../AppRouter.ts";
import type { ProjectApi } from "../../api/ProjectApi.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";
import ProjectUpdate from "./ProjectUpdate.tsx";

const ProjectSettings = () => {
	const alepha = useAlepha();
	const { tr } = useI18n<I18n, "en">();
	const projectApi = useClient<ProjectApi>();
	const router = useRouter<AppRouter>();
	const [project] = useStore("project");

	if (!project) {
		return null;
	}

	return (
		<Flex fill col pad2>
			<h3>{tr("project.settings.general.title")}</h3>
			<ProjectUpdate project={project} />
			<h3>{tr("project.settings.danger.title")}</h3>
			<Flex card pad2 bordered shadow>
				<Flex col>
					<Text>{tr("project.settings.actions.delete")}</Text>
					<Text small muted>
						{tr("project.settings.actions.delete.helper")}
					</Text>
				</Flex>
				<Flex fill />
				<Flex>
					<Action
						text={tr("project.settings.actions.delete")}
						intent={"danger"}
						onClick={() => {
							projectApi
								.deleteProjectById({
									params: { id: project.id },
								})
								.then(() => {
									alepha.state(
										"user.projects",
										(alepha.state("user.projects") ?? []).filter(
											(p) => p.id !== project.id,
										),
									);

									router.go("home");
								});
						}}
					/>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default ProjectSettings;
