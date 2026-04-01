import { Flex, Text } from "@alepha/ui";
import { Avatar } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { useAuth } from "alepha/react/auth";
import { NestedView } from "alepha/react/router";
import { theme } from "@/web/app/constants/theme.ts";
import MeLayoutMenu from "./MeLayoutMenu.tsx";

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
        <Flex w={{ base: "100%", md: 196 }} miw={{ md: 196 }}>
          <MeLayoutMenu />
        </Flex>
        <Flex flex={1} className="overflow-auto">
          <NestedView />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default MeLayout;
