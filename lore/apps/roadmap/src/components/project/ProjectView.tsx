import { NestedView, useRouterState } from "@alepha/react";
import { Card, Container, Flex, Stack, Text } from "@mantine/core";
import { theme } from "../../constants/theme.ts";
import ExperienceBar from "../shared/ExperienceBar.tsx";
import ProjectActions from "./ProjectActions.tsx";
import ProjectBanner from "./ProjectBanner.tsx";
import QuestLog from "./QuestLog.tsx";

const ProjectView = () => {
	return (
		<Stack p={0} gap={0} flex={1} className={"overflow-auto"}>
			<Card
				p={"xs"}
				flex={1}
				radius={0}
				bg={theme.colors.panel}
				withBorder
				style={{
					borderLeft: 0,
					borderRight: 0,
				}}
			>
				<Flex flex={1} className={"overflow-auto"}>
					<Flex flex={1} visibleFrom={"md"}>
						<QuestLog />
					</Flex>

					<Container
						fluid
						className={"overflow-auto"}
						h={"100%"}
						w={theme.container}
						mx={0}
						px={"xs"}
					>
						<Stack w={"100%"} gap={"xs"} h={"100%"} className={"overflow-auto"}>
							<Flex hiddenFrom={"lg"} w={"100%"}>
								<ProjectActions />
							</Flex>
							<Flex px={"xs"} mb={-16}>
								<ProjectBanner />
							</Flex>
							<NestedView />
						</Stack>
					</Container>

					<Flex
						flex={1}
						visibleFrom={"lg"}
						style={{
							height: "100%",
						}}
					>
						<History />
					</Flex>
				</Flex>
			</Card>
			<ExperienceBar />
		</Stack>
	);
};

export default ProjectView;

const History = () => {
	const router = useRouterState();
	if (!router.params.taskId) {
		return;
	}

	return (
		<Flex flex={1} p={"xs"} style={{ paddingLeft: 0, perspective: 1000 }}>
			<Flex flex={1} align="center" justify="center">
				<Text size="sm" c={"dimmed"}>
					Quest History
				</Text>
			</Flex>
		</Flex>
	);
};
