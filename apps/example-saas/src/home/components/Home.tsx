import { ActionButton } from "@alepha/ui";
import {
  Card,
  Flex,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconArrowRight, IconSettings, IconTicket } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface AppCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  href: string;
  color: string;
  badge?: string;
}

const AppCard = ({
  title,
  description,
  icon,
  href,
  color,
  badge,
}: AppCardProps) => {
  return (
    <ActionButton
      unstyled
      href={href}
      h={256}
      style={{ width: "256px", textDecoration: "none" }}
    >
      <Card
        withBorder
        bg={"var(--alepha-background)"}
        padding="xl"
        radius="md"
        style={{
          cursor: "pointer",
          transition: "all 0.2s ease",
          height: "100%",
          borderColor: "transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-4px)";
          e.currentTarget.style.boxShadow = "0 12px 24px rgba(0, 0, 0, 0.1)";
          e.currentTarget.style.borderColor = "var(--alepha-border)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "";
          e.currentTarget.style.borderColor = "transparent";
        }}
      >
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <ThemeIcon
              size={56}
              radius="md"
              variant="light"
              style={{ transform: "rotate(45deg)" }}
            >
              {icon}
            </ThemeIcon>
          </Group>

          <Stack gap={4}>
            <Group gap="xs">
              <Title order={3}>{title}</Title>
              <IconArrowRight size={20} style={{ opacity: 0.5 }} />
            </Group>
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          </Stack>
        </Stack>
      </Card>
    </ActionButton>
  );
};

const Home = () => {
  const apps: AppCardProps[] = [
    {
      title: "Book a Trip",
      description:
        "Search and book AlephaRail tickets across Canada with real-time availability and instant confirmation.",
      icon: <IconTicket size={32} />,
      href: "/booking",
      color: "blue",
      badge: "Customer Portal",
    },
    {
      title: "Administration",
      description:
        "Manage bookings, customers, inventory, and system configuration.",
      icon: <IconSettings size={32} />,
      href: "/admin",
      color: "orange",
      badge: "Admin Portal",
    },
  ];

  return (
    <Flex
      align={"center"}
      justify={"center"}
      flex={1}
      gap={"md"}
      style={{
        minHeight: "100vh",
      }}
    >
      {apps.map((app) => (
        <AppCard key={app.title} {...app} />
      ))}
    </Flex>
  );
};

export default Home;
