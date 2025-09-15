import { useActive, useRouter } from "@alepha/react";
import { Flex, HoverCard, Text } from "@mantine/core";
import { IconExclamationMark, IconSparkles } from "@tabler/icons-react";
import type { AppRouter } from "../../../AppRouter.ts";
import type { Task } from "../../../api/providers/Db.ts";
import Action from "../../ui/Action.tsx";
import TaskComplexity from "./TaskComplexity.tsx";

const TaskItem = (props: { task: Task }) => {
	const { task } = props;

	const router = useRouter<AppRouter>();
	const { isActive, anchorProps } = useActive(
		router.path("projectTask", { params: { taskId: task.id } }),
	);

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
				<TaskComplexity complexity={task.complexity} />
				{task.title}
				{!!task.objectives.length && task.objectives.length > 1 && (
					<Text size={"10px"}>
						{task.objectives.filter((it) => it.completed).length}/
						{task.objectives.length}
					</Text>
				)}
			</Flex>
		</Action>
	);
};

export default TaskItem;
