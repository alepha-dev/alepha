import { useActive, useRouter } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { Icon, Popover } from "@blueprintjs/core";
import type { Task } from "../../providers/Db.ts";

const TaskItem = (props: { task: Task }) => {
	const { task } = props;

	const router = useRouter();
	const { isActive, anchorProps } = useActive(`/q/${task.id}`);

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

	const flexProps = isActive
		? {
				bordered: true,
				shadow: true,
				"aria-current": "page",
				"data-active": true,
				style: {
					padding: "2px 4px",
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
					router.go("/");
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
							<Icon icon={"clean"} color={"var(--text-muted)"} />
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
							<Icon
								icon={"high-priority"}
								color={"var(--color-high-priority)"}
							/>
						</Flex>
					</Popover>
				</Flex>
			)}
		</Flex>
	);
};

export default TaskItem;

/*
	<Action
					icon={"tick"}
					variant={"minimal"}
					intent={"success"}
					title={"Validate Task"}
					disabled={!taskApi.deleteTask.can()}
					onClick={async () => {
						await taskApi.deleteTask({
							params: { id: task.id },
						});
						alepha.state(
							"tasks",
							(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
						);
					}}
				/>
				<Action
					disabled={!taskApi.deleteTask.can()}
					icon={"cross"}
					variant={"minimal"}
					intent={"danger"}
					title={"Delete Task"}
					onClick={async () => {
						await taskApi.deleteTask({
							params: { id: task.id },
						});
						alepha.state(
							"tasks",
							(alepha.state("tasks") ?? []).filter((t) => t.id !== task.id),
						);
					}}
				/>
 */
