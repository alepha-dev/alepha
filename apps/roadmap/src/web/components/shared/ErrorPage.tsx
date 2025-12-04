import { Button, Flex, Text } from "@mantine/core";
import {
  IconArrowLeft,
  IconHeartBroken,
  IconHome,
  IconReload,
} from "@tabler/icons-react";
import Action from "../ui/Action.jsx";

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
            <Action
              leftSection={<IconArrowLeft />}
              onClick={() => window.history.back()}
            >
              Back
            </Action>
            <Action
              leftSection={<IconReload />}
              onClick={() => window.location.reload()}
            >
              Reload App
            </Action>
            <Action
              leftSection={<IconHome />}
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Home
            </Action>
          </Button.Group>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default ErrorPage;
