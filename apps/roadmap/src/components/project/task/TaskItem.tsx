import { useActive, useRouter, useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { Popover } from "@blueprintjs/core";
import { Clean, HighPriority } from "@blueprintjs/icons";
import type { AppRouter } from "../../../AppRouter.ts";
import type { Task } from "../../../api/providers/Db.ts";

const TaskItem = (props: { task: Task }) => {
	const { task } = props;

	const router = useRouter<AppRouter>();
	const [project] = useStore("project");
	const { isActive, isPending, anchorProps } = useActive(
		`/p/${project?.id}/q/${task.id}`,
	);

	const renderComplexity = (complexity: number) => {
		if (complexity === 5)
			return (
				<Flex
					shadow
					bg
					rounded
					bordered
					center
					style={{ width: 25, borderColor: "#d1810a" }}
				>
					<Text large bold>
						S
					</Text>
				</Flex>
			);
		if (complexity === 4)
			return (
				<Flex shadow bg rounded bordered center style={{ width: 25 }}>
					<Text large bold>
						A
					</Text>
				</Flex>
			);
		if (complexity === 3)
			return (
				<Flex bg rounded bordered center style={{ width: 25 }}>
					<Text large bold>
						B
					</Text>
				</Flex>
			);
		if (complexity === 2)
			return (
				<Flex style={{ width: 25 }} rounded bordered center>
					<Text large bold>
						C
					</Text>
				</Flex>
			);
		return (
			<Flex style={{ width: 25 }} rounded bordered center>
				<Text large bold>
					F
				</Text>
			</Flex>
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
						padding: "2px 4px",
						borderLeftColor: "var(--text-color)",
						borderRightColor: "var(--text-color)",
					},
				}
			: {
					style: {
						padding: "2px 4px",
						border: "1px solid transparent",
					},
				};

	return (
		<Flex
			gap1
			card
			rounded
			onClick={() => {
				if (isActive) {
					router.go("projectBoard");
				} else {
					anchorProps.onClick();
				}
			}}
			{...flexProps}
		>
			{renderComplexity(task.complexity)}

			<Flex center>
				<Flex col>
					<Text>{task.title}</Text>
				</Flex>
			</Flex>

			<Flex fill />

			{task.priority === "optional" && (
				<Flex center>
					<Popover
						hoverOpenDelay={1000}
						interactionKind={"hover"}
						content={
							<Flex pad1 col>
								<Text bold>Bonus</Text>
								<Text small>This quest is optional.</Text>
							</Flex>
						}
					>
						<Flex pad1h>
							<Clean color={"var(--text-muted)"} />
						</Flex>
					</Popover>
				</Flex>
			)}

			{task.priority === "high" && (
				<Flex center>
					<Popover
						hoverOpenDelay={1000}
						interactionKind={"hover"}
						content={
							<Flex pad1 col>
								<Text bold>High Priority !</Text>
								<Text small>Which means more rewards.</Text>
							</Flex>
						}
					>
						<Flex pad1h>
							<HighPriority color={"var(--color-high-priority)"} />
						</Flex>
					</Popover>
				</Flex>
			)}
		</Flex>
	);
};

export default TaskItem;
