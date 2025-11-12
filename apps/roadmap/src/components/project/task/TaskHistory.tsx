import { DateTimeProvider } from "@alepha/datetime";
import { useInject, useStore } from "@alepha/react";
import { Flex, Text, Timeline, Transition } from "@mantine/core";
import {
  IconCheckbox,
  IconCross,
  IconEdit,
  IconSignature,
  IconSunset2,
  IconSwords,
} from "@tabler/icons-react";
import { currentTaskAtom } from "../../../atoms/currentTaskAtom.ts";
import type { Task } from "../../../entities/tasks.ts";

const TaskHistory = () => {
  const [task] = useStore(currentTaskAtom);

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

  console.log(task);

  const title = (action: string) => {
    if (action === "assigned") {
      return "Courageous Choice";
    }
    if (action === "unassigned") {
      return "Fateful Decision";
    }
    if (action === "completed") {
      return "At Long Last";
    }
    if (action === "created") {
      return "A New Dawn";
    }
    if (action === "objective_completed") {
      return "Objective Achieved";
    }
    return "Notable Change";
  };

  const description = (action: string) => {
    if (action === "objective_completed") {
      return (
        <Text c="dimmed" size="sm">
          Objective has been completed by
          <Text variant="link" component="span" inherit>
            {" "}
            You
          </Text>
          .
        </Text>
      );
    }
    return (
      <Text c="dimmed" size="sm">
        Quest has been {action} by
        <Text variant="link" component="span" inherit>
          {" "}
          You
        </Text>
        .
      </Text>
    );
  };

  return (
    <Timeline active={1} bulletSize={24} lineWidth={2}>
      {task.completedAt && (
        <Timeline.Item
          style={style}
          title={title("completed")}
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
      {task.history.toReversed().map((it) => (
        <Timeline.Item
          key={it.at}
          style={style}
          title={title(it.action)}
          bullet={
            it.action === "assigned" ? (
              <IconSignature size={12} />
            ) : it.action === "objective_completed" ? (
              <IconCheckbox size={12} />
            ) : it.action === "unassigned" ? (
              <IconCross size={12} />
            ) : (
              <IconEdit size={12} />
            )
          }
        >
          {description(it.action)}
          <Text size="xs" mt={4}>
            {dt.of(it.at).fromNow()}
          </Text>
        </Timeline.Item>
      ))}
      <Timeline.Item
        style={style}
        bullet={<IconSunset2 size={12} />}
        title={title("created")}
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
    </Timeline>
  );
};
