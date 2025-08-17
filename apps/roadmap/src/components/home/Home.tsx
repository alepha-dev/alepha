import { DateTimeProvider } from "@alepha/datetime";
import { useInject, useRouter, useStore } from "@alepha/react";
import { Flex, Grid, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Application, CubeAdd } from "@blueprintjs/icons";
import type { AppRouter } from "../../AppRouter.ts";
import type { Project } from "../../api/providers/Db.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";

export interface HomeProps {
	projects: Project[];
}

const Home = () => {
	const { tr } = useI18n<I18n, "en">();
	const [projects = []] = useStore("user.projects");
	const router = useRouter<AppRouter>();
	const dt = useInject(DateTimeProvider);

	return (
		<Flex fill col pad2>
			<Flex gap3 col pad2 className={"container"}>
				<Flex bg pad3 rounded shadow bordered>
					<Grid md={2} gap2 flexProps={{ fill: true }}>
						<Flex col gap1>
							<Text bold large>
								{tr("home.title")}
							</Text>
							<Text small>{tr("home.subtitle")}</Text>
						</Flex>
						<Flex fill>
							<Flex fill visible={"md"} />
							<Flex fill pad1 bordered rounded card shadow>
								<Action
									fill
									variant={"minimal"}
									icon={<CubeAdd />}
									text={tr("home.create-campaign")}
									href={router.path("projectCreate")}
								/>
							</Flex>
						</Flex>
					</Grid>
				</Flex>
				<Flex col gap1>
					<Text>{tr("home.campaigns")}</Text>
					<Flex col bg rounded>
						{projects.length > 0 ? (
							<Flex pad2 bordered rounded gap2 col>
								{projects
									.toSorted((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
									.map((project) => (
										<Flex key={project.id} card fill bordered rounded shadow>
											<Action
												fill
												icon={<Application />}
												alignText={"left"}
												variant={"minimal"}
												{...router.anchor("project", {
													params: { projectId: project.id },
												})}
											>
												<Flex col pad1h>
													<Text bold>{project.title}</Text>
													<Text small muted>
														Updated {dt.of(project.updatedAt).fromNow()}
													</Text>
												</Flex>
											</Action>
										</Flex>
									))}
							</Flex>
						) : (
							<Flex pad2 center>
								<Text muted>{tr("home.no-campaign")}</Text>
							</Flex>
						)}
					</Flex>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Home;
