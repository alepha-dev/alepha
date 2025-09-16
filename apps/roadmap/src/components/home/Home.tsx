import { DateTimeProvider } from "@alepha/datetime";
import { useInject, useRouter, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { Card, Container, Flex, SimpleGrid, Stack, Text } from "@mantine/core";
import {
	IconCircleArrowRight,
	IconCubePlus,
	IconMapRoute,
} from "@tabler/icons-react";
import type { AppRouter } from "../../AppRouter.ts";
import { theme } from "../../constants/theme.ts";
import type { Project } from "../../providers/Db.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../ui/Action.tsx";

export interface HomeProps {
	projects: Project[];
}

const Home = () => {
	const { tr } = useI18n<I18n, "en">();
	const [projects = []] = useStore("user_projects");
	const router = useRouter<AppRouter>();
	const dt = useInject(DateTimeProvider);

	return (
		<Stack>
			<Flex
				style={{ zIndex: -1, filter: "" }}
				pos={"absolute"}
				w={"100%"}
				h={"256px"}
				bg={
					"linear-gradient(180deg, var(--panel-bg-color) 0%, transparent 100%)"
				}
				top={0}
			></Flex>
			<Container size={"xl"}>
				<Flex
					flex={1}
					mt={"md"}
					w={{
						md: "100%",
						lg: "920px",
					}}
					gap={"lg"}
					direction={"column"}
					p={"sm"}
				>
					<Card
						p={"lg"}
						withBorder
						radius={"md"}
						bg={theme.colors.panel}
						className={"shadow"}
					>
						<SimpleGrid
							cols={{
								sm: 1,
								md: 2,
							}}
							spacing={"sm"}
						>
							<Flex direction={"column"}>
								<Text fw={"bold"} size={"lg"}>
									{tr("home.title")}
								</Text>
								<Text size="sm" c={"gray"}>
									{tr("home.subtitle")}
								</Text>
							</Flex>
							<Flex flex={1}>
								<Flex flex={1} visibleFrom={"md"} />
								<Flex flex={1} align={"center"}>
									<Card
										w={"100%"}
										withBorder
										p={2}
										radius={"md"}
										bg={"var(--card-bg-color)"}
									>
										<Action
											size={"md"}
											variant={"subtle"}
											leftSection={<IconCubePlus size={16} />}
											href={router.path("projectCreate")}
										>
											{tr("home.create-campaign")}
										</Action>
									</Card>
								</Flex>
							</Flex>
						</SimpleGrid>
					</Card>
					<Flex direction={"column"} gap={"xs"}>
						<Text size={"sm"}>{tr("home.campaigns")}</Text>
						<Flex gap={"md"}>
							<Card
								radius={projects.length > 0 ? "xs" : "md"}
								p={0}
								withBorder={projects.length > 0}
								flex={1}
								bg={"var(--panel-bg-color)"}
							>
								{projects.length > 0 ? (
									<Flex p={"sm"} gap={"sm"} direction={"column"}>
										{projects
											.toSorted((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
											.map((project) => (
												<Card
													withBorder
													bg={"var(--card-bg-color)"}
													p={2}
													key={project.id}
													flex={1}
													radius={"md"}
													className={"shadow"}
												>
													<Action
														flex={1}
														justify={"space-between"}
														rightSection={<IconCircleArrowRight size={20} />}
														variant={"subtle"}
														href={router.path("project", {
															params: { projectId: project.id },
														})}
													>
														<Flex py={4} flex={1} align={"center"} gap={"sm"}>
															<IconMapRoute size={20} />
															<Flex
																flex={1}
																w={"100%"}
																direction={"column"}
																ta={"left"}
															>
																<Text size={"sm"}>{project.title}</Text>
																<Text size={"xs"} c={"dimmed"}>
																	Updated {dt.of(project.updatedAt).fromNow()}
																</Text>
															</Flex>
														</Flex>
													</Action>
												</Card>
											))}
									</Flex>
								) : (
									<Flex p={"md"} align="center" justify="center">
										<Text c={"dimmed"} size={"sm"}>
											{tr("home.no-campaign")}
										</Text>
									</Flex>
								)}
							</Card>
							<Flex flex={1} visibleFrom={"md"}></Flex>
						</Flex>
					</Flex>
				</Flex>
			</Container>
		</Stack>
	);
};

export default Home;
