import { DateTimeProvider } from "@alepha/datetime";
import { useInject, useRouter, useStore } from "@alepha/react";
import { Flex, Grid, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Divider } from "@blueprintjs/core";
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
		<Flex fill col pad2 bg>
			<Flex gap3 col pad2 className={"container"}>
				<Grid md={2} gap2>
					<Flex col gap1>
						<Text bold large>
							{tr("home.title")}
						</Text>
						<Text>{tr("home.subtitle")}</Text>
					</Flex>
					<Flex>
						<Flex fill />
						<Flex pad1 bordered rounded card shadow>
							<Action
								variant={"minimal"}
								icon={<CubeAdd />}
								text={tr("home.create-campaign")}
								href={router.path("projectCreate")}
							/>
						</Flex>
					</Flex>
				</Grid>
				<Divider />
				<Text>{tr("home.campaigns")}</Text>
				<Flex col>
					{projects.length > 0 ? (
						<Flex
							card
							pad3
							bordered
							rounded
							gap3
							style={{
								flexWrap: "wrap",
							}}
						>
							{projects.map((project) => (
								<Action
									style={{ width: 256 }}
									key={project.id}
									icon={<Application />}
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
											{dt.of(project.updatedAt).fromNow()}
										</Text>
									</Flex>
								</Action>
							))}
						</Flex>
					) : (
						<Flex>
							<Text muted>{tr("home.no-campaign")}</Text>
						</Flex>
					)}
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Home;
