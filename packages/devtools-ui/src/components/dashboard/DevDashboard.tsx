import { Flex, ui } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  ScrollArea,
  SimpleGrid,
  Text,
  Title,
} from "@mantine/core";
import {
  IconApi,
  IconAtom,
  IconBrandNodejs,
  IconBroadcast,
  IconClock,
  IconCpu,
  IconDatabase,
  IconFileText,
  IconPlug,
  IconRoute,
  IconServer,
  IconSettings,
  IconStack2,
  IconTerminal,
  IconVariable,
} from "@tabler/icons-react";
import { devMetadataSchema } from "alepha/devtools";
import { useInject } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";

interface LogEntry {
  level: string;
  message: string;
  module: string;
  service: string;
  data?: any;
  timestamp: number;
}

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const levelColors: Record<string, string> = {
  ERROR: "red",
  WARN: "yellow",
  INFO: "blue",
  DEBUG: "gray",
  TRACE: "dimmed",
};

const eventTypeColors: Record<string, string> = {
  http: "teal",
  db: "violet",
  error: "red",
};

const detectEventType = (data: any): string | undefined => {
  if (!data || typeof data !== "object") return undefined;
  if (data.status && data.method && data.path && data.duration) return "http";
  if (data.type === "db:query") return "db";
  return undefined;
};

const formatEvent = (entry: LogEntry): string => {
  const data = entry.data;
  const eventType = detectEventType(data);
  if (eventType === "http") {
    return `${data.method} ${data.path} → ${data.status} (${data.duration}ms)`;
  }
  if (eventType === "db") {
    return `${data.operation} (${Math.round(data.duration)}ms)`;
  }
  return entry.message;
};

export const DevDashboard = () => {
  const http = useInject(HttpClient);
  const router = useRouter();
  const [metadata, setMetadata] = useState<any>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<LogEntry[]>([]);

  const fetchData = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const [metaRes, logsRes, eventsRes] = await Promise.all([
        http.fetch("/__devtools/api/metadata", {
          schema: { response: devMetadataSchema },
        }),
        http.fetch("/__devtools/api/logs?limit=10&level=DEBUG"),
        http.fetch("/__devtools/api/logs?limit=20&type=http,db"),
      ]);
      setMetadata(metaRes.data);
      setLogs((logsRes.data as any)?.logs ?? []);
      setEvents((eventsRes.data as any)?.logs ?? []);
    } catch {
      // silently fail
    }
  }, [http]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const system = metadata?.system;

  const primitiveStats = useMemo(() => {
    if (!metadata) return [];
    return [
      {
        label: "Actions",
        count: metadata.actions?.length ?? 0,
        icon: IconApi,
        color: "teal",
      },
      {
        label: "Pages",
        count: metadata.pages?.length ?? 0,
        icon: IconFileText,
        color: "blue",
      },
      {
        label: "Entities",
        count: metadata.entities?.length ?? 0,
        icon: IconDatabase,
        color: "violet",
      },
      {
        label: "Queues",
        count: metadata.queues?.length ?? 0,
        icon: IconStack2,
        color: "orange",
      },
      {
        label: "Topics",
        count: metadata.topics?.length ?? 0,
        icon: IconBroadcast,
        color: "pink",
      },
      {
        label: "Caches",
        count: metadata.caches?.length ?? 0,
        icon: IconRoute,
        color: "cyan",
      },
      {
        label: "Providers",
        count: metadata.providers?.length ?? 0,
        icon: IconPlug,
        color: "grape",
      },
      {
        label: "Atoms",
        count: metadata.atoms?.length ?? 0,
        icon: IconAtom,
        color: "lime",
      },
      {
        label: "Env Vars",
        count: metadata.envs?.length ?? 0,
        icon: IconVariable,
        color: "yellow",
      },
      {
        label: "Commands",
        count: metadata.commands?.length ?? 0,
        icon: IconTerminal,
        color: "gray",
      },
    ];
  }, [metadata]);

  return (
    <Flex
      p="lg"
      w={"100%"}
      flex={1}
      direction="column"
      style={{ overflow: "auto" }}
    >
      <Flex direction="column" gap="lg">
        {/* App Stats */}
        <div>
          <Title
            order={5}
            mb="sm"
            c="dimmed"
            tt="uppercase"
            fz="xs"
            fw={600}
            lts={1}
          >
            System
          </Title>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="sm">
            {system && (
              <>
                <StatCard
                  icon={IconServer}
                  label="Runtime"
                  value={system.runtime === "bun" ? "Bun" : "Node.js"}
                />
                <StatCard
                  icon={IconBrandNodejs}
                  label="Version"
                  value={system.nodeVersion}
                />
                <StatCard
                  icon={IconSettings}
                  label="Mode"
                  value={system.mode}
                />
                <StatCard
                  icon={IconRoute}
                  label="Port"
                  value={String(system.port)}
                />
                <StatCard
                  icon={IconClock}
                  label="Uptime"
                  value={formatUptime(system.uptime)}
                />
                <StatCard
                  icon={IconCpu}
                  label="Memory"
                  value={formatBytes(system.memoryUsage)}
                />
              </>
            )}
          </SimpleGrid>
        </div>

        <Grid gutter="lg">
          {/* Recent Events */}
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card
              padding="md"
              radius="md"
              style={{
                background: ui.colors.surface,
                border: `1px solid ${ui.colors.border}`,
              }}
            >
              <Title
                order={5}
                mb="sm"
                c="dimmed"
                tt="uppercase"
                fz="xs"
                fw={600}
                lts={1}
              >
                Recent Events
              </Title>
              <ScrollArea h={280}>
                <Flex direction="column" gap={4}>
                  {events.length === 0 && (
                    <Text c="dimmed" fz="sm" ta="center" py="xl">
                      No events yet
                    </Text>
                  )}
                  {events.map((entry, i) => {
                    const eventType = detectEventType(entry.data) ?? "log";
                    return (
                      <Flex
                        key={`${entry.timestamp}-${i}`}
                        gap="xs"
                        px="xs"
                        py={4}
                        style={{
                          borderRadius: 4,
                          cursor: "pointer",
                          transition: "background 150ms",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.background =
                            `${ui.colors.elevated}`;
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background =
                            "transparent";
                        }}
                      >
                        <Text
                          fz="xs"
                          c="dimmed"
                          ff="monospace"
                          w={55}
                          style={{ flexShrink: 0 }}
                        >
                          {new Date(entry.timestamp).toLocaleTimeString("en", {
                            hour12: false,
                          })}
                        </Text>
                        <Badge
                          size="xs"
                          variant="light"
                          color={eventTypeColors[eventType] ?? "gray"}
                          style={{ flexShrink: 0 }}
                        >
                          {eventType === "http"
                            ? "HTTP"
                            : eventType === "db"
                              ? "DB"
                              : "LOG"}
                        </Badge>
                        <Text
                          fz="xs"
                          ff="monospace"
                          truncate
                          style={{ flex: 1 }}
                        >
                          {formatEvent(entry)}
                        </Text>
                      </Flex>
                    );
                  })}
                </Flex>
              </ScrollArea>
            </Card>
          </Grid.Col>

          {/* Recent Logs */}
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card
              padding="md"
              radius="md"
              style={{
                background: ui.colors.surface,
                border: `1px solid ${ui.colors.border}`,
              }}
            >
              <Flex justify="space-between" mb="sm">
                <Title
                  order={5}
                  c="dimmed"
                  tt="uppercase"
                  fz="xs"
                  fw={600}
                  lts={1}
                >
                  Recent Logs
                </Title>
                <Text
                  fz="xs"
                  c="blue"
                  style={{ cursor: "pointer" }}
                  onClick={() => router.push("/logs")}
                >
                  View all
                </Text>
              </Flex>
              <ScrollArea h={280}>
                <Flex direction="column" gap={4}>
                  {logs.length === 0 && (
                    <Text c="dimmed" fz="sm" ta="center" py="xl">
                      No logs yet
                    </Text>
                  )}
                  {logs.map((entry, i) => (
                    <Flex
                      key={`${entry.timestamp}-${i}`}
                      gap="xs"
                      px="xs"
                      py={4}
                      style={{ borderRadius: 4 }}
                    >
                      <Badge
                        size="xs"
                        variant="light"
                        color={levelColors[entry.level] ?? "gray"}
                        w={50}
                        style={{ flexShrink: 0 }}
                      >
                        {entry.level}
                      </Badge>
                      <Text
                        fz="xs"
                        c="dimmed"
                        w={80}
                        truncate
                        style={{ flexShrink: 0 }}
                      >
                        {entry.module}
                      </Text>
                      <Text fz="xs" ff="monospace" truncate style={{ flex: 1 }}>
                        {entry.message}
                      </Text>
                    </Flex>
                  ))}
                </Flex>
              </ScrollArea>
            </Card>
          </Grid.Col>
        </Grid>

        {/* Primitives Stats */}
        <div>
          <Title
            order={5}
            mb="sm"
            c="dimmed"
            tt="uppercase"
            fz="xs"
            fw={600}
            lts={1}
          >
            Primitives
          </Title>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm">
            {primitiveStats.map((stat) => (
              <Card
                key={stat.label}
                padding="sm"
                radius="md"
                style={{
                  background: ui.colors.surface,
                  border: `1px solid ${ui.colors.border}`,
                }}
              >
                <Flex gap="sm">
                  <stat.icon size={18} opacity={0.5} />
                  <div style={{ flex: 1 }}>
                    <Text fz="xs" c="dimmed">
                      {stat.label}
                    </Text>
                    <Text fz="lg" fw={700} lh={1.2}>
                      {stat.count}
                    </Text>
                  </div>
                </Flex>
              </Card>
            ))}
          </SimpleGrid>
        </div>
      </Flex>
    </Flex>
  );
};

const StatCard = ({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) => (
  <Card
    padding="sm"
    radius="md"
    style={{
      background: ui.colors.surface,
      border: `1px solid ${ui.colors.border}`,
    }}
  >
    <Flex gap="xs">
      <Icon size={16} opacity={0.4} />
      <div>
        <Text fz={10} c="dimmed" tt="uppercase" lts={0.5}>
          {label}
        </Text>
        <Text fz="sm" fw={600} ff="monospace" lh={1.3}>
          {value}
        </Text>
      </div>
    </Flex>
  </Card>
);

export default DevDashboard;
