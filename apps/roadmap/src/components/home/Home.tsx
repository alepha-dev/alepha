import { useClient, useRouter, useSchema, useStore } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { Dialog, DialogBody, DialogFooter } from "@blueprintjs/core";
import { useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type ProjectApi from "../../api/ProjectApi.ts";
import type { Project } from "../../providers/Db.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";
import Control from "../shared/Control.tsx";

const Home = () => {
	const { tr } = useI18n<I18n, "en">();
	const [projects = [], setProjects] = useStore("user.projects");
	const router = useRouter<AppRouter>();

	return (
		<Flex fill col gap2 bg>
			<Flex pad2 col center gap2>
				<Flex style={{ width: 1, height: "calc(var(--spacing) * 4)" }} />
				<Flex col center>
					<Text bold large>
						{tr("roadmap.home.title")}
					</Text>
					<Text muted small>
						{tr("roadmap.home.subtitle")}
					</Text>
				</Flex>
				<Flex style={{ width: 1, height: "calc(var(--spacing) * 4)" }} />
				<Flex>
					{projects.length > 0 ? (
						<Flex col gap2>
							{projects.map((project) => (
								<Action
									style={{ width: 256 }}
									key={project.id}
									icon={"projects"}
									alignText={"left"}
									variant={"outlined"}
									{...router.anchor("project", {
										params: { projectId: project.id },
									})}
								>
									<Flex col pad1h>
										<Text bold large>
											{project.title}
										</Text>
										<Text small muted>
											{project.createdAt}
										</Text>
									</Flex>
								</Action>
							))}
						</Flex>
					) : (
						<CreateNewProject
							onSubmit={(project) => setProjects([...projects, project])}
						/>
					)}
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Home;

const CreateNewProject = (props: { onSubmit: (project: Project) => void }) => {
	const client = useClient<ProjectApi>();
	const schema = useSchema(client.createProject);
	const [isOpen, setIsOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const auth = useAuth();
	const router = useRouter();

	const form = useForm({
		schema: schema.body,
		handler: async (body) => {
			setLoading(true);
			const project = await client.createProject({ body });
			setIsOpen(false);
			props.onSubmit(project);
			setLoading(false);
		},
	});

	return (
		<>
			<Action
				text={"Create New Project"}
				intent={"success"}
				icon={"plus"}
				onClick={() => {
					if (!auth.user) {
						return router.go("login", {
							query: { r: "/" },
						});
					}
					setIsOpen(!isOpen);
				}}
			/>
			<Dialog
				isOpen={isOpen}
				onClose={() => setIsOpen(false)}
				icon={"plus"}
				title={"Create New Project"}
			>
				<form onSubmit={form.onSubmit}>
					<DialogBody>
						<Control inputField={form.input.title} />
						<Control inputField={form.input.public} />
					</DialogBody>
					<DialogFooter
						actions={
							<Action
								text={"Submit"}
								icon={"tick"}
								loading={loading}
								type={"submit"}
							/>
						}
					></DialogFooter>
				</form>
			</Dialog>
		</>
	);
};
