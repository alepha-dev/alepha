import { ActionButton, type ActionProps, Flex, Text } from "@alepha/ui";
import { Avatar } from "@mantine/core";
import {
  IconAntenna,
  IconKey,
  IconMail,
  IconMapRoute,
  IconShield,
  IconUser,
} from "@tabler/icons-react";
import { useAuth } from "alepha/react/auth";
import { NestedView, useRouter } from "alepha/react/router";
import { theme } from "@/web/app/constants/theme.ts";
import type { MeRouter } from "./MeRouter.ts";

const MeLayout = () => {
  const auth = useAuth();

  return (
    <Flex
      direction="column"
      flex={1}
      w="100%"
      maw={theme.container.xl}
      mx="auto"
      className="overflow-auto"
      p="md"
      gap="md"
    >
      {/* Compact header */}
      <Flex
        align="center"
        gap="md"
        p="md"
        bg="var(--alepha-elevated)"
        style={{
          borderRadius: "var(--mantine-radius-md)",
          border: "1px solid var(--alepha-border)",
        }}
      >
        <Avatar
          src={
            auth.user?.picture ? `/api/files/${auth.user.picture}` : undefined
          }
          size={40}
          radius="xl"
        >
          <IconUser size={20} />
        </Avatar>
        <Flex direction="column" gap={0}>
          <Text size="sm" fw={600}>
            {auth.user?.username || "Anonymous"}
          </Text>
          <Text size="xs" c="dimmed">
            {auth.user?.email}
          </Text>
        </Flex>
      </Flex>

      {/* Content */}
      <Flex
        className="overflow-auto"
        flex={1}
        gap="md"
        direction={{ base: "column", md: "row" }}
      >
        <Flex w={{ base: "100%", md: 180 }} miw={{ md: 180 }}>
          <MeMenu />
        </Flex>
        <Flex flex={1} className="overflow-auto">
          <NestedView />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default MeLayout;

const MeMenu = () => {
  const meRouter = useRouter<MeRouter>();

  return (
    <Flex
      p="xs"
      gap={2}
      w={{ base: "100%", md: 180 }}
      bg="var(--alepha-elevated)"
      direction={{ base: "row", md: "column" }}
      style={{
        borderRadius: "var(--mantine-radius-md)",
        border: "1px solid var(--alepha-border)",
      }}
    >
      <Text
        visibleFrom="md"
        size="xs"
        c="dimmed"
        tt="uppercase"
        fw={600}
        px="xs"
        pt="xs"
      >
        General
      </Text>
      <NavLink icon={<IconUser size={16} />} href={meRouter.path("profile")}>
        Profile
      </NavLink>
      <NavLink
        icon={<IconMapRoute size={16} />}
        href={meRouter.path("characters")}
      >
        Campaigns
      </NavLink>
      <NavLink
        icon={<IconMail size={16} />}
        href={meRouter.path("invitations")}
      >
        Invitations
      </NavLink>
      <Text
        visibleFrom="md"
        size="xs"
        c="dimmed"
        tt="uppercase"
        fw={600}
        px="xs"
        pt="sm"
      >
        Security
      </Text>
      <NavLink
        icon={<IconShield size={16} />}
        href={meRouter.path("identities")}
      >
        Identities
      </NavLink>
      <NavLink
        icon={<IconAntenna size={16} />}
        href={meRouter.path("sessions")}
      >
        Sessions
      </NavLink>
      <NavLink icon={<IconKey size={16} />} href={meRouter.path("apiKeys")}>
        API Keys
      </NavLink>
    </Flex>
  );
};

const NavLink = (
  props: ActionProps & { href: string; icon: React.ReactNode },
) => {
  return (
    <ActionButton
      size="xs"
      textVisibleFrom="sm"
      justify="flex-start"
      variant="minimal"
      leftSection={props.icon}
      href={props.href}
    >
      {props.children}
    </ActionButton>
  );
};
