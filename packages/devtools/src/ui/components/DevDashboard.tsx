import { useInject } from "@alepha/react";
import { ui } from "@alepha/ui";
import { Box, Flex, SimpleGrid, Text } from "@mantine/core";
import {
  IconApi,
  IconArchive,
  IconAtom,
  IconBucket,
  IconCalendarEvent,
  IconDatabase,
  IconLock,
  IconMessageCircle,
  IconPackages,
  IconServer,
  IconStack2,
  IconTerminal,
  IconTools,
  IconVariable,
} from "@tabler/icons-react";
import { HttpClient } from "alepha/server";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  type DevMetadata,
  devMetadataSchema,
} from "../../api/schemas/DevMetadata.ts";

interface StatCardProps {
  label: string;
  count: number;
  icon: ReactNode;
}

const StatCard = ({ label, count, icon }: StatCardProps) => (
  <Flex
    direction="column"
    align="center"
    justify="center"
    p="xl"
    style={{
      borderRadius: 12,
      border: `1px solid ${ui.colors.border}`,
      cursor: "pointer",
      transition: "all 0.2s ease",
    }}
    bg={ui.colors.surface}
    className="devtools-card"
  >
    <Box opacity={0.5} mb="md">
      {icon}
    </Box>
    <Text size="sm" c="dimmed">
      <Text span fw={600} size="lg" c="var(--mantine-color-text)">
        {count}
      </Text>{" "}
      {label}
    </Text>
  </Flex>
);

export const DevDashboard = () => {
  const http = useInject(HttpClient);
  const [metadata, setMetadata] = useState<DevMetadata | null>(null);

  useEffect(() => {
    http
      .fetch("/devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => setMetadata(res.data));
  }, []);

  if (!metadata) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  const stats = [
    {
      label: "actions",
      count: metadata.actions.length,
      icon: <IconApi size={48} stroke={1.2} />,
    },
    {
      label: "entities",
      count: metadata.entities.length,
      icon: <IconDatabase size={48} stroke={1.2} />,
    },
    {
      label: "queues",
      count: metadata.queues.length,
      icon: <IconStack2 size={48} stroke={1.2} />,
    },
    {
      label: "schedulers",
      count: metadata.schedulers.length,
      icon: <IconCalendarEvent size={48} stroke={1.2} />,
    },
    {
      label: "topics",
      count: metadata.topics.length,
      icon: <IconMessageCircle size={48} stroke={1.2} />,
    },
    {
      label: "buckets",
      count: metadata.buckets.length,
      icon: <IconBucket size={48} stroke={1.2} />,
    },
    {
      label: "realms",
      count: metadata.realms.length,
      icon: <IconLock size={48} stroke={1.2} />,
    },
    {
      label: "caches",
      count: metadata.caches.length,
      icon: <IconArchive size={48} stroke={1.2} />,
    },
    {
      label: "commands",
      count: metadata.commands.length,
      icon: <IconTerminal size={48} stroke={1.2} />,
    },
    {
      label: "env schemas",
      count: metadata.envs.length,
      icon: <IconVariable size={48} stroke={1.2} />,
    },
    {
      label: "atoms",
      count: metadata.atoms.length,
      icon: <IconAtom size={48} stroke={1.2} />,
    },
    {
      label: "modules",
      count: metadata.modules.length,
      icon: <IconPackages size={48} stroke={1.2} />,
    },
    {
      label: "services",
      count: metadata.providers.length,
      icon: <IconServer size={48} stroke={1.2} />,
    },
  ].filter((stat) => stat.count > 0);

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      flex={1}
      w="100%"
      gap="xl"
    >
      <style>
        {`
          .devtools-card:hover {
            border-color: var(--mantine-color-dimmed);
            transform: translateY(-2px);
          }
        `}
      </style>

      <Flex direction="column" align="center" gap={4} mb="md">
        <Flex align="center" gap="sm">
          <IconTools size={40} stroke={1.5} opacity={0.8} />
          <Text size="2rem" fw={300} style={{ letterSpacing: "-0.02em" }}>
            Alepha DevTools
          </Text>
        </Flex>
        <Text size="xs" c="dimmed">
          Explore your Alepha application metadata
        </Text>
      </Flex>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="md">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </SimpleGrid>
    </Flex>
  );
};

export default DevDashboard;
