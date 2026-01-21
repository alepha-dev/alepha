import { ActionButton } from "@alepha/ui";
import { Button, Flex, Text } from "@mantine/core";
import {
  IconArrowLeft,
  IconHeartBroken,
  IconHome,
  IconReload,
} from "@tabler/icons-react";

const ErrorPage = () => {
  return (
    <Flex flex={1} align="center" justify="center">
      <Flex direction={"column"} gap={"md"} align="center" justify="center">
        <Text c={"dimmed"}>
          <IconHeartBroken size={48} />
        </Text>
        <Flex gap={"xs"} direction={"column"} align="center" justify="center">
          <Text size="lg" fw={"bold"}>
            Oh no! Something went wrong.
          </Text>
          <Text c={"dimmed"} size="sm">
            We apologize for the inconvenience. Please try again later or
            contact support if the issue persists.
          </Text>
        </Flex>
        <Flex>
          <Button.Group>
            <ActionButton
              leftSection={<IconArrowLeft />}
              onClick={() => window.history.back()}
            >
              Back
            </ActionButton>
            <ActionButton
              leftSection={<IconReload />}
              onClick={() => window.location.reload()}
            >
              Reload App
            </ActionButton>
            <ActionButton
              leftSection={<IconHome />}
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Home
            </ActionButton>
          </Button.Group>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default ErrorPage;
