import { NestedView } from "@alepha/react";
import { AlephaMantineProvider, DarkModeButton } from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { AppShell, Flex, Group, Image, Title } from "@mantine/core";

const BookingLayout = () => {
  return (
    <AlephaMantineProvider>
      <AppShell w={"100%"} header={{ height: 60 }} withBorder={false}>
        <AppShell.Header
          bg={"transparent"}
          style={{
            // blur
            backdropFilter: "blur(10px)",
          }}
        >
          <Flex h="100%" px="md" align="center" justify="space-between">
            <Group gap="sm">
              <Image w={32} h={32} src={"/android-chrome-192x192.png"} />
              <Title order={4}>AlephaRail</Title>
            </Group>
            <Group gap="xs">
              <UserButton variant="subtle" />
              <DarkModeButton />
            </Group>
          </Flex>
        </AppShell.Header>
        <AppShell.Main>
          <NestedView />
        </AppShell.Main>
      </AppShell>
    </AlephaMantineProvider>
  );
};

export default BookingLayout;
