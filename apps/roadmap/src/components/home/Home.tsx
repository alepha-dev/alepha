import { useRouter, useStore } from "@alepha/react";
import { Flex, Grid, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Divider } from "@blueprintjs/core";
import type { AppRouter } from "../../AppRouter.ts";
import type { Project } from "../../providers/Db.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";

export interface HomeProps {
	projects: Project[];
}

const Home = () => {
	const { tr } = useI18n<I18n, "en">();
	const [projects = []] = useStore("user.projects");
	const router = useRouter<AppRouter>();

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
						<Flex pad1 bordered rounded card>
							<Action
								variant={"minimal"}
								icon={"cube-add"}
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
							gap2
							style={{
								flexWrap: "wrap",
							}}
						>
							{projects.map((project) => (
								<Action
									key={project.id}
									icon={"application"}
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
