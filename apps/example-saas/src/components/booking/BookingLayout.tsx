import { NestedView } from "@alepha/react";
import { DarkModeButton, ThemeButton } from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { AppShell, Flex, Group, Title } from "@mantine/core";
import { IconTrain } from "@tabler/icons-react";

const BookingLayout = () => {
  return (
    <AppShell w={"100%"} header={{ height: 60 }}>
      <AppShell.Header>
        <Flex h="100%" px="md" align="center" justify="space-between">
          <Group gap="sm">
            <IconTrain size={28} stroke={1.5} />
            <Title order={4}>TrainBooking</Title>
          </Group>
          <Group gap="xs">
            <ThemeButton />
            <DarkModeButton />
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
