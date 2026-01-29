import { ActionButton } from "@alepha/ui";
import { Card, Flex, Group, Stack, Text } from "@mantine/core";
import {
  IconCircleFilled,
  IconDeviceDesktop,
  IconDeviceMobile,
} from "@tabler/icons-react";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useState } from "react";
import type {
  SessionController,
  UserSession,
} from "../../../../api/controllers/SessionController.ts";
import { theme } from "../../constants/theme.ts";

export interface MySessionsProps {
  sessions: Array<UserSession>;
}

const MySessions = (props: MySessionsProps) => {
  const dt = useInject(DateTimeProvider);
  const [sessions, setSessions] = useState<Array<UserSession>>(props.sessions);
  const auth = useAuth();
  const sessionApi = useClient<SessionController>();

  return (
    <Stack w="100%" p={"xs"} gap={0}>
      <Group p={"xs"} justify={"space-between"}>
        <Flex px={1}>
          <Text size="xs" c={"dimmed"}>
            You can revoke any session to log out from it.
          </Text>
        </Flex>

        <Flex align="center" justify="center">
          <ActionButton
            c={"red"}
            variant={"subtle"}
            onClick={async () => {
              await sessionApi.revokeAllSessions();
              auth.logout();
            }}
          >
            Revoke All
          </ActionButton>
        </Flex>
      </Group>

      <Card withBorder bg={theme.colors.panel} w="100%" p={"xs"} radius={"md"}>
        <Stack gap={"xs"}>
          {sessions.map((session) => (
            <Card
              radius="md"
              className={"shadow"}
              withBorder
              bg={theme.colors.card}
              p={"xs"}
              w={"100%"}
              key={session.id}
            >
              <Group px={"sm"}>
                <IconCircleFilled
                  size={12}
                  color={session.current ? "green" : "gray"}
                />

                <Flex align="center" justify="center" px={"xs"}>
                  {session.userAgent?.device === "MOBILE" ? (
                    <IconDeviceMobile />
                  ) : (
                    <IconDeviceDesktop />
                  )}
                </Flex>

                <Stack gap={0}>
                  <Group align="center" gap={"xs"}>
                    <Text size="sm">
                      {session.userAgent?.browser} ({session.userAgent?.os}){" "}
                    </Text>
                    <Text size="xs">{session.ip}</Text>
                  </Group>
                  <Text size="xs" c={"dimmed"}>
                    Signed in {dt.of(session.createdAt).fromNow()}
                  </Text>
                </Stack>

                <Flex flex={1} />

                <Flex align="center" justify="center" visibleFrom={"sm"}>
                  <ActionButton
                    variant={"subtle"}
                    onClick={async () => {
                      if (session.current) {
                        auth.logout();
                      } else {
                        await sessionApi.revokeSession({
                          params: {
                            sessionId: session.id,
                          },
                        });
                        setSessions((prev) =>
                          prev.filter((s) => s.id !== session.id),
                        );
                      }
                    }}
                  >
                    {session.current ? "Sign out" : "Revoke"}
                  </ActionButton>
                </Flex>
              </Group>
            </Card>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
};

export default MySessions;

// ---------------------------------------------------------------------------------------------------------------------

// Support only Android for now

const getDeviceIconFromUserAgent = (userAgent: string) => {
  if (userAgent.includes("Android")) {
    return <IconDeviceMobile />;
  } else {
    return <IconDeviceDesktop />;
  }
};

const getOsFromUserAgent = (userAgent: string) => {
  if (userAgent.includes("Android")) {
    return "Android";
  } else if (userAgent.includes("Win64")) {
    return "Windows";
  } else {
    return "Windows";
  }
};
