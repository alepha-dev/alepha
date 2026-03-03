import { Card, Typography } from "@mantine/core";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { theme } from "@/web/app/constants/theme.ts";

export interface TaskDescriptionProps {
  task: TaskResource;
  onEdit: () => void;
}

const TaskDescription = (props: TaskDescriptionProps) => {
  return (
    <Card
      withBorder
      bg={theme.colors.panel}
      p={"sm"}
      px={"md"}
      radius={"md"}
      style={{
        overflow: "unset",
      }}
    >
      <Typography>
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: ...
          dangerouslySetInnerHTML={{
            __html: props.task.description,
          }}
        />
      </Typography>
    </Card>
  );
};

export default TaskDescription;
