import { useActive, useRouter, useStore } from "@alepha/react";
import { Card, Flex, HoverCard, Text } from "@mantine/core";
import { IconExclamationMark, IconSparkles } from "@tabler/icons-react";
import type { AppRouter } from "../../../AppRouter.ts";
import type { Task } from "../../../api/providers/Db.ts";
import { theme } from "../../../constants/theme.ts";
import Action from "../../ui/Action.tsx";

const TaskItem = (props: { task: Task }) => {
	const { task } = props;

	const router = useRouter<AppRouter>();
	const [project] = useStore("project");
	const { isActive, isPending, anchorProps } = useActive(
		router.path("projectTask", { params: { taskId: task.id } }),
	);

	const renderComplexityText = (letter: string) => {
		return (
			<Text size="md" fw={"bold"} lh={"21px"}>
				{letter}
			</Text>
		);
	};

	const renderComplexity = (complexity: number) => {
		if (complexity === 5)
			return (
				<Card
					p={0}
					w={25}
					h={25}
					radius={"md"}
					withBorder
					className={"shadow"}
					style={{ borderColor: theme.colors.gold }}
					bg={theme.colors.panel}
				>
					{renderComplexityText("S")}
				</Card>
			);
		if (complexity === 4)
			return (
				<Card
					p={0}
					w={25}
					h={25}
					radius={"md"}
					withBorder
					className={"shadow"}
					style={{ borderColor: theme.colors.silver }}
					bg={theme.colors.panel}
				>
					{renderComplexityText("A")}
				</Card>
			);
		if (complexity === 3)
			return (
				<Card
					p={0}
					w={25}
					h={25}
					radius={"md"}
					withBorder
					bg={theme.colors.panel}
				>
					{renderComplexityText("B")}
				</Card>
			);
		if (complexity === 2)
			return (
				<Card
					p={0}
					w={25}
					h={25}
					radius={"md"}
					withBorder
					bg={theme.colors.card}
				>
					{renderComplexityText("C")}
				</Card>
			);
		return (
			<Card p={0} w={25} h={25} radius={"md"} withBorder bg={theme.colors.card}>
				{renderComplexityText("F")}
			</Card>
		);
	};

	const flexProps =
		isActive || isPending
			? {
					bordered: true,
					shadow: true,
					"aria-current": "page",
					"data-active": true,
					style: {
						opacity: isPending ? 0.5 : 1,
						padding: "2px 4px",
						borderLeftColor: "var(--text-color)",
						borderRightColor: "var(--text-color)",
					},
				}
			: {
					style: {
						opacity: isPending ? 0.5 : 1,
						padding: "2px 4px",
						border: "1px solid transparent",
					},
				};

	return (
		<Action
			href={isActive ? router.path("project") : anchorProps.href}
			active={{
				href: anchorProps.href,
			}}
			variant={isActive ? "light" : "subtle"}
			justify={"space-between"}
			rightSection={
				task.priority === "optional" ? (
					<Flex align="center" justify="center">
						<HoverCard openDelay={1000} position="bottom-start">
							<HoverCard.Target>
								<Flex px={1}>
									<IconSparkles color={"var(--text-muted)"} />
								</Flex>
							</HoverCard.Target>
							<HoverCard.Dropdown>
								<Flex p={"xs"} direction={"column"}>
									<Text fw={"bold"}>Bonus</Text>
									<Text size="sm">This quest is optional.</Text>
								</Flex>
							</HoverCard.Dropdown>
						</HoverCard>
					</Flex>
				) : task.priority === "high" ? (
					<Flex align="center" justify="center">
						<HoverCard openDelay={1000} position="bottom-start">
							<HoverCard.Target>
								<Flex px={1}>
									<IconExclamationMark color={"var(--color-high-priority)"} />
								</Flex>
							</HoverCard.Target>
							<HoverCard.Dropdown>
								<Flex p={"xs"} direction={"column"}>
									<Text fw={"bold"}>High Priority !</Text>
									<Text size="sm">Which means more rewards.</Text>
								</Flex>
							</HoverCard.Dropdown>
						</HoverCard>
					</Flex>
				) : undefined
			}
		>
			<Flex flex={1} align={"center"} gap={"sm"}>
				{renderComplexity(task.complexity)}
				{task.title}
			</Flex>
		</Action>
	);
};

export default TaskItem;
