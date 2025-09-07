import { DateTimeProvider } from "@alepha/datetime";
import { useInject, useStore } from "@alepha/react";
import { Flex, Text, Timeline, Transition } from "@mantine/core";
import {
	IconCross,
	IconEdit,
	IconSignature,
	IconSunset2,
	IconSwords,
} from "@tabler/icons-react";
import type { Task } from "../../../api/providers/Db.ts";

const TaskHistory = () => {
	const [task] = useStore("task");

	return (
		<Flex
			flex={1}
			p={"xs"}
			style={{ paddingLeft: 0, perspective: 1000 }}
			className={"overflow-auto"}
		>
			<Transition
				mounted={!!task}
				transition="fade-right"
				duration={400}
				timingFunction="ease"
			>
				{(styles) => (
					<Flex
						flex={1}
						gap={"sm"}
						px="md"
						py={"xl"}
						direction={"column"}
						style={styles}
					>
						{task ? <TaskTimeline task={task} /> : null}
					</Flex>
				)}
			</Transition>
		</Flex>
	);
};

export default TaskHistory;

const TaskTimeline = ({ task }: { task: Task }) => {
	const dt = useInject(DateTimeProvider);
	const style = {
		animation: "fadeInUpLight 0.3s ease forwards",
	};

	return (
		<Timeline active={1} bulletSize={24} lineWidth={2}>
			<Timeline.Item
				style={style}
				bullet={<IconSunset2 size={12} />}
				title="A New Dawn"
			>
				<Text c="dimmed" size="sm">
					Quest has been created by
					<Text variant="link" component="span" inherit>
						{" "}
						You
					</Text>
					.
				</Text>
				<Text size="xs" mt={4}>
					{dt.of(task.createdAt).fromNow()}
				</Text>
			</Timeline.Item>

			{task.history.map((it) => (
				<Timeline.Item
					key={it.at}
					style={style}
					title={
						it.action === "assigned"
							? "Courageous Choice"
							: it.action === "unassigned"
								? "Fateful Decision"
								: "Notable Change"
					}
					bullet={
						it.action === "assigned" ? (
							<IconSignature size={12} />
						) : it.action === "unassigned" ? (
							<IconCross size={12} />
						) : (
							<IconEdit size={12} />
						)
					}
				>
					<Text c="dimmed" size="sm">
						Quest has been {it.action} by
						<Text variant="link" component="span" inherit>
							{" "}
							You
						</Text>
						.
					</Text>
					<Text size="xs" mt={4}>
						{dt.of(it.at).fromNow()}
					</Text>
				</Timeline.Item>
			))}

			{task.completedAt && (
				<Timeline.Item
					style={style}
					title="At Long Last"
					bullet={<IconSwords size={12} />}
				>
					<Text c="dimmed" size="sm">
						Quest has been completed by
						<Text variant="link" component="span" inherit>
							{" "}
							You
						</Text>
						.
					</Text>
					<Text size="xs" mt={4}>
						{dt.of(task.completedAt).fromNow()}
					</Text>
				</Timeline.Item>
			)}
		</Timeline>
	);
};
