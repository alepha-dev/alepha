import { Button, Flex, Text, useToast } from "@alepha/ui";
import {
  IconCheck,
  IconExclamationMark,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";

const DemoToast = () => {
  const toast = useToast();

  return (
    <Flex col gap="xl" p="xl">
      <Text bold size="lg">
        Toast Service
      </Text>
      <Text muted small>
        Notification toasts via the ToastService. Fire-and-forget notifications
        for user feedback.
      </Text>

      <Flex gap="md" wrap="wrap">
        <Button
          icon={IconCheck}
          variant="light"
          intent="success"
          onClick={() => toast.success("Operation completed successfully.")}
        >
          Success
        </Button>

        <Button
          icon={IconX}
          variant="light"
          intent="danger"
          onClick={() => toast.danger("Something went wrong.")}
        >
          Error
        </Button>

        <Button
          icon={IconExclamationMark}
          variant="light"
          intent="warning"
          onClick={() => toast.warning("Please check your input.")}
        >
          Warning
        </Button>

        <Button
          icon={IconInfoCircle}
          variant="light"
          intent="info"
          onClick={() => toast.info("Here is some useful information.")}
        >
          Info
        </Button>
      </Flex>

      <Flex col gap="md">
        <Text bold small uppercase muted>
          With Title
        </Text>
        <Flex gap="md" wrap="wrap">
          <Button
            variant="light"
            intent="success"
            onClick={() =>
              toast.success({
                message: "Your changes have been saved.",
                title: "Saved",
              })
            }
          >
            With Title
          </Button>
          <Button
            variant="light"
            intent="danger"
            onClick={() =>
              toast.danger({
                message: "Failed to connect to the server.",
                title: "Connection Error",
                autoClose: false,
              })
            }
          >
            Persistent
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default DemoToast;
