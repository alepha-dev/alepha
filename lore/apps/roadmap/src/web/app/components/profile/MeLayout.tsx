import { useAuth } from "@alepha/react/auth";
import { NestedView, useRouter } from "@alepha/react/router";
import { ActionButton, type ActionProps } from "@alepha/ui";
import { Card, Container, Flex, Stack, Text } from "@mantine/core";
import {
  IconAntenna,
  IconKey,
  IconMail,
  IconMapRoute,
  IconShield,
  IconUser,
} from "@tabler/icons-react";
import { theme } from "../../constants/theme.ts";
import type { MeRouter } from "./MeRouter.ts";

const MeLayout = () => {
  const auth = useAuth();
  return (
    <Container w={theme.container} flex={1} className={"overflow-auto"}>
      <Stack flex={1} w={"100%"}>
        <Card
          withBorder
          className={"shadow"}
          flex={1}
          p={"md"}
          px={"lg"}
          bg={theme.colors.panel}
        >
          <Text>{auth.user?.username}</Text>
          <Text size={"xs"}>{auth.user?.email}</Text>
        </Card>
        <Flex
          className={"overflow-auto"}
          flex={1}
          gap={"lg"}
          direction={{
            base: "column",
            md: "row",
          }}
        >
          <Flex
            h={"100%"}
            w={{
              base: "100%",
              md: "196px",
            }}
          >
            <MeMenu />
          </Flex>
          <Flex flex={1} className={"overflow-auto"}>
            <NestedView />
          </Flex>
        </Flex>
      </Stack>
    </Container>
  );
};

export default MeLayout;

const MeMenu = () => {
  const meRouter = useRouter<MeRouter>();

  return (
    <Card
      withBorder
      bg={theme.colors.app}
      p={"xs"}
      w={{
        base: "100%",
        md: "196px",
      }}
    >
      <Flex
        flex={1}
        gap={"xs"}
        direction={{
          base: "row",
          md: "column",
        }}
      >
        <Text visibleFrom={"md"} size="xs">
          General
        </Text>
        <ActionNavLink
          leftSection={<IconUser size={20} />}
          href={meRouter.path("profile")}
        >
          Profile
        </ActionNavLink>
        <ActionNavLink
          leftSection={<IconMapRoute size={20} />}
          href={meRouter.path("characters")}
        >
          Campaigns
        </ActionNavLink>
        <ActionNavLink
          leftSection={<IconMail size={20} />}
          href={meRouter.path("invitations")}
        >
          Invitations
        </ActionNavLink>
        <Text visibleFrom={"md"} size="xs">
          Security
        </Text>
        <ActionNavLink
          leftSection={<IconShield size={20} />}
          href={meRouter.path("identities")}
        >
          Identities
        </ActionNavLink>
        <ActionNavLink
          leftSection={<IconAntenna size={20} />}
          href={meRouter.path("sessions")}
        >
          Sessions
        </ActionNavLink>
        <ActionNavLink
          leftSection={<IconKey size={20} />}
          href={meRouter.path("apiKeys")}
        >
          API Keys
        </ActionNavLink>
      </Flex>
    </Card>
  );
};

const ActionNavLink = (props: ActionProps & { href: string }) => {
  return (
    <ActionButton
      size={"xs"}
      textVisibleFrom={"sm"}
      justify={"flex-start"}
      variant={"subtle"}
      {...props}
    >
      {props.children}
    </ActionButton>
  );
};
