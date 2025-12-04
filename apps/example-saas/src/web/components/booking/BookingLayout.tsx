import { NestedView } from "@alepha/react";
import { ActionButton, DarkModeButton, ThemeButton } from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { AppShell, Flex, Group, Title } from "@mantine/core";
import { IconSettings, IconTrain } from "@tabler/icons-react";

const BookingLayout = () => {
  return (
    <AppShell w={"100%"} header={{ height: 60 }} withBorder={false}>
      <AppShell.Header>
        <Flex h="100%" px="md" align="center" justify="space-between">
          <Group gap="sm">
            <IconTrain size={28} stroke={1.5} />
            <Title order={4}>Vectura</Title>
          </Group>
          <Group gap="xs">
            <ThemeButton />
            <DarkModeButton />
            <ActionButton href={"/admin"} icon={IconSettings} />
            <UserButton variant="subtle" />
          </Group>
        </Flex>
      </AppShell.Header>
      <AppShell.Main>
        <NestedView />
      </AppShell.Main>
    </AppShell>
  );
};

export default BookingLayout;
