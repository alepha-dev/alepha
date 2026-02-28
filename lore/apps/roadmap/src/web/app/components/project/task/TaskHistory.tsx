import { Flex } from "@alepha/ui";
import { Transition } from "@mantine/core";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import TaskHistoryTimeline from "./TaskHistoryTimeline.tsx";

const TaskHistory = (props: { task: TaskResource }) => {
  const task = props.task;

  return (
    <Flex>
      <Transition
        mounted={!!task}
        transition="fade-right"
        duration={400}
        timingFunction="ease"
      >
        {(styles) => (
          <Flex flex={1} py={"md"} direction={"column"} style={styles}>
            {task ? <TaskHistoryTimeline task={task} /> : null}
          </Flex>
        )}
      </Transition>
    </Flex>
  );
};

export default TaskHistory;
