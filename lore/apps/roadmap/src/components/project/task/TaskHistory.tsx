import { DateTimeProvider } from "@alepha/datetime";
import { useInject, useStore } from "@alepha/react";
import { Flex, Text, Timeline, Transition } from "@mantine/core";
import { IconSignature, IconSunset2, IconSwords } from "@tabler/icons-react";
import type { Task } from "../../../api/providers/Db.ts";

const TaskHistory = () => {
	const [task] = useStore("task");

	return (
		<Flex flex={1} p={"xs"} style={{ paddingLeft: 0, perspective: 1000 }}>
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
						<Text size={"xs"} c={"dimmed"} fs={"italic"}>
							History is currently limited.
						</Text>
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

	return (
		<Timeline active={1} bulletSize={24} lineWidth={2}>
			<Timeline.Item
				style={{
					animation: "fadeInUpLight 0.3s ease forwards",
				}}
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

			{task.acceptedAt && (
				<Timeline.Item
					style={{
						animation: "fadeInUpLight 0.3s ease forwards",
					}}
					title="Courageous Choice"
					bullet={<IconSignature size={12} />}
				>
					<Text c="dimmed" size="sm">
						Quest has been accepted by
						<Text variant="link" component="span" inherit>
							{" "}
							You
						</Text>
						.
					</Text>
					<Text size="xs" mt={4}>
						{dt.of(task.acceptedAt).fromNow()}
					</Text>
				</Timeline.Item>
			)}

			{task.completedAt && (
				<Timeline.Item
					style={{
						animation: "fadeInUpLight 0.3s ease forwards",
					}}
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
