import { ActionButton, Flex } from "@alepha/ui";
import { Card, Modal, Typography } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMaximize } from "@tabler/icons-react";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { theme } from "@/web/app/constants/theme.ts";

export interface TaskDescriptionProps {
  task: TaskResource;
  onEdit: () => void;
}

const TaskDescription = (props: TaskDescriptionProps) => {
  const [opened, { open, close }] = useDisclosure(false);

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
      <Modal opened={opened} onClose={close} size={"xl"}>
        <Typography px={"xl"}>
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: ...
            dangerouslySetInnerHTML={{
              __html: props.task.description,
            }}
          />
        </Typography>
        <Flex p={"md"} />
      </Modal>
      <ActionButton
        px={"xs"}
        variant={"minimal"}
        onClick={open}
        style={{ right: 4, top: 4, position: "absolute" }}
      >
        <IconMaximize size={theme.icon.size.md} />
      </ActionButton>
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
