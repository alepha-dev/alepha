import { ActionButton, Flex, Text, useDialog } from "@alepha/mantine";
import {
  IconAlertCircle,
  IconMessage,
  IconQuestionMark,
} from "@tabler/icons-react";

const DemoDialog = () => {
  const dialog = useDialog();

  return (
    <Flex col gap="xl" p="xl">
      <Text bold size="lg">
        Dialog Service
      </Text>
      <Text muted small>
        Programmatic dialogs via the DialogService. No need to mount modal
        components — just call the service.
      </Text>

      <Flex gap="md" wrap="wrap">
        <ActionButton
          icon={IconAlertCircle}
          variant="light"
          onClick={() =>
            dialog.alert({
              title: "Heads up",
              message: "This is an informational alert dialog.",
            })
          }
        >
          Alert
        </ActionButton>

        <ActionButton
          icon={IconQuestionMark}
          variant="light"
          intent="warning"
          onClick={async () => {
            const ok = await dialog.confirm({
              title: "Confirm action",
              message: "Are you sure you want to proceed?",
            });
            if (ok) {
              dialog.alert({
                title: "Confirmed",
                message: "You confirmed the action.",
              });
            }
          }}
        >
          Confirm
        </ActionButton>

        <ActionButton
          icon={IconMessage}
          variant="light"
          intent="primary"
          onClick={async () => {
            const value = await dialog.prompt({
              title: "Enter a value",
              message: "What is your name?",
              placeholder: "John Doe",
            });
            if (value) {
              dialog.alert({
                title: "Hello",
                message: `Nice to meet you, ${value}!`,
              });
            }
          }}
        >
          Prompt
        </ActionButton>
      </Flex>

      <Flex col gap="md">
        <Text bold small uppercase muted>
          Variants
        </Text>
        <Flex gap="md" wrap="wrap">
          <ActionButton
            variant="light"
            intent="danger"
            onClick={() =>
              dialog.confirm({
                title: "Delete item",
                message:
                  "This action cannot be undone. Are you sure you want to delete this item?",
                confirmColor: "red",
                confirmLabel: "Delete",
              })
            }
          >
            Danger Confirm
          </ActionButton>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default DemoDialog;
