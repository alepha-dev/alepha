import { Flex, Text, ui } from "@alepha/ui";
import { Timeline } from "@mantine/core";
import {
  IconCheckbox,
  IconCross,
  IconEdit,
  IconSignature,
  IconSunset2,
  IconSwords,
} from "@tabler/icons-react";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import type { ReactNode } from "react";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";

export interface TaskHistoryTimelineProps {
  task: TaskResource;
}

const TaskHistoryTimeline = (props: TaskHistoryTimelineProps) => {
  const { task } = props;
  const dt = useInject(DateTimeProvider);
  const style = {
    animation: "fadeInUpLight 0.3s ease forwards",
  };

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
          <Text span bold inherit>
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
        <Text span bold inherit>
          {" "}
          You
        </Text>
        .
      </Text>
    );
  };

  const renderItem = (
    action: string,
    icon: ReactNode,
    when: string,
    itemDescription: ReactNode,
  ) => {
    return (
      <Timeline.Item mt={8} key={when} style={style} bullet={icon}>
        <Flex>
          <Flex w={"100%"} col fill>
            <Text>{title(action)}</Text>
            <Flex>{itemDescription}</Flex>
          </Flex>
          <Text size="xs" mt={4}>
            {dt.of(when).fromNow()}
          </Text>
        </Flex>
      </Timeline.Item>
    );
  };

  const iconSize = ui.sizes.icon.xs;

  return (
    <Timeline w={"100%"} active={0} bulletSize={24} lineWidth={2}>
      {task.completedAt &&
        renderItem(
          "completed",
          <IconSwords size={iconSize} />,
          task.completedAt,
          <Text c="dimmed" size="xs">
            Quest has been completed by
            <Text span variant="link" inherit>
              {" "}
              You
            </Text>
            .
          </Text>,
        )}
      {task.history
        .toReversed()
        .map((it) =>
          renderItem(
            it.action,
            it.action === "assigned" ? (
              <IconSignature size={iconSize} />
            ) : it.action === "objective_completed" ? (
              <IconCheckbox size={iconSize} />
            ) : it.action === "unassigned" ? (
              <IconCross size={iconSize} />
            ) : (
              <IconEdit size={iconSize} />
            ),
            it.at,
            description(it.action),
          ),
        )}

      {renderItem(
        "created",
        <IconSunset2 size={iconSize} />,
        task.createdAt,
        <Text c="dimmed" size="sm">
          Quest has been created by
          <Text span bold inherit>
            {" "}
            You
          </Text>
          .
        </Text>,
      )}
    </Timeline>
  );
};

export default TaskHistoryTimeline;
