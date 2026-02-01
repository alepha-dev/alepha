import {
  ActionButton,
  ClipboardButton,
  DataTable,
  Flex,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Box,
  Code,
  Group,
  Paper,
  RingProgress,
  SimpleGrid,
  Stack,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconCalendarOff,
  IconCheck,
  IconClock,
  IconKey,
  IconNetwork,
  IconShieldCheck,
  IconShieldOff,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AdminApiKeyController } from "alepha/api/keys";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useCallback, useState } from "react";
import type { AdminRouter } from "../../AdminRouter.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ApiKeyResource {
  id: string;
  userId: string;
  name: string;
  description?: string;
  tokenPrefix: string;
  tokenSuffix: string;
  roles: string[];
  createdAt: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  expiresAt?: string;
  revokedAt?: string;
  usageCount: number;
}

interface KeyStats {
  total: number;
  active: number;
  revoked: number;
  expired: number;
  neverUsed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const getKeyStatus = (
  key: ApiKeyResource,
): "active" | "revoked" | "expired" => {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return "expired";
  return "active";
};

const getStatusColor = (status: "active" | "revoked" | "expired") => {
  switch (status) {
    case "active":
      return "teal";
    case "revoked":
      return "red";
    case "expired":
      return "orange";
  }
};

const getStatusIcon = (status: "active" | "revoked" | "expired") => {
  switch (status) {
    case "active":
      return <IconShieldCheck size={14} />;
    case "revoked":
      return <IconShieldOff size={14} />;
    case "expired":
      return <IconCalendarOff size={14} />;
  }
};

const formatKeyPreview = (prefix: string, suffix: string) => {
  return `${prefix}...${suffix}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Stats Cards
// ─────────────────────────────────────────────────────────────────────────────

interface StatsCardsProps {
  stats: KeyStats;
  loading: boolean;
}

const StatsCards = ({ stats, loading }: StatsCardsProps) => {
  const activePercentage =
    stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0;

  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Total Keys
            </Text>
            <Text size="xl" fw={700} ff="monospace">
              {stats.total}
            </Text>
          </Box>
          <ThemeIcon size="lg" radius="md" variant="light" color="blue">
            <IconKey size={20} />
          </ThemeIcon>
        </Group>
      </Paper>

      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Active
            </Text>
            <Text size="xl" fw={700} ff="monospace" c="teal">
              {stats.active}
            </Text>
          </Box>
          <RingProgress
            size={48}
            thickness={4}
            roundCaps
            sections={[{ value: activePercentage, color: "teal" }]}
          />
        </Group>
      </Paper>

      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Revoked
            </Text>
            <Text size="xl" fw={700} ff="monospace" c="red">
              {stats.revoked}
            </Text>
          </Box>
          <ThemeIcon
            size="lg"
            radius="md"
            variant="light"
            color={stats.revoked > 0 ? "red" : "gray"}
          >
            <IconShieldOff size={20} />
          </ThemeIcon>
        </Group>
      </Paper>

      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Never Used
            </Text>
            <Text size="xl" fw={700} ff="monospace" c="yellow">
              {stats.neverUsed}
            </Text>
          </Box>
          <ThemeIcon
            size="lg"
            radius="md"
            variant="light"
            color={stats.neverUsed > 0 ? "yellow" : "gray"}
          >
            <IconClock size={20} />
          </ThemeIcon>
        </Group>
      </Paper>
    </SimpleGrid>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const AdminApiKeys = () => {
  const client = useClient<AdminApiKeyController>();
  const router = useRouter<AdminRouter>();
  const { l } = useI18n();
  const toast = useToast();
  const dialog = useDialog();

  const [stats, setStats] = useState<KeyStats>({
    total: 0,
    active: 0,
    revoked: 0,
    expired: 0,
    neverUsed: 0,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const filters = t.object({
    userId: t.optional(t.uuid()),
    includeRevoked: t.optional(t.boolean()),
  });

  const handleRevoke = useCallback(
    async (key: ApiKeyResource) => {
      const confirmed = await dialog.confirm({
        title: "Revoke API Key",
        message: `Are you sure you want to revoke "${key.name}"? This action cannot be undone and will immediately invalidate the key.`,
        confirmLabel: "Revoke Key",
        confirmColor: "red",
      });

      if (!confirmed) return;

      try {
        await client.revokeApiKey({ params: { id: key.id } });
        toast.success(`API key "${key.name}" has been revoked`);
        setRefreshKey((k) => k + 1);
      } catch (error) {
        toast.danger(`Failed to revoke API key`);
      }
    },
    [client, dialog, toast],
  );

  // Calculate stats from loaded data
  const updateStats = useCallback((keys: ApiKeyResource[]) => {
    const now = new Date();
    const newStats: KeyStats = {
      total: keys.length,
      active: 0,
      revoked: 0,
      expired: 0,
      neverUsed: 0,
    };

    for (const key of keys) {
      if (key.revokedAt) {
        newStats.revoked++;
      } else if (key.expiresAt && new Date(key.expiresAt) < now) {
        newStats.expired++;
      } else {
        newStats.active++;
      }

      if (!key.lastUsedAt) {
        newStats.neverUsed++;
      }
    }

    setStats(newStats);
    setLoading(false);
  }, []);

  return (
    <Flex flex={1} direction="column" gap="md">
      {/* Stats Header */}
      <StatsCards stats={stats} loading={loading} />

      {/* API Keys Table */}
      <DataTable<ApiKeyResource, typeof filters>
        key={refreshKey}
        submitOnInit
        defaultSize={15}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 2,
        }}
        tableProps={{
          horizontalSpacing: "sm",
          verticalSpacing: "sm",
          highlightOnHover: true,
        }}
        onFilterChange={(key, _value, form) => {
          if (key === "userId" || key === "includeRevoked") {
            return form.submit();
          }
        }}
        filters={filters}
        tableTrProps={(item) => {
          const status = getKeyStatus(item);
          if (status === "revoked") {
            return {
              opacity: 0.6,
              style: {
                textDecoration: "line-through",
                textDecorationColor: "var(--mantine-color-red-5)",
              },
            };
          }
          if (status === "expired") {
            return { opacity: 0.7 };
          }
          return {};
        }}
        items={async (filters) => {
          const response = await client.findApiKeys({
            query: {
              ...filters,
              includeRevoked: filters.includeRevoked ?? true,
            },
          });

          // Update stats with all keys (need to fetch all for accurate stats)
          const allKeys = await client.findApiKeys({
            query: { includeRevoked: true, size: 100 },
          });
          updateStats(allKeys.content as ApiKeyResource[]);

          return response as Page<ApiKeyResource>;
        }}
        columns={{
          name: {
            label: "Name",
            value: (item) => (
              <Stack gap={2}>
                <Group gap="xs">
                  <ThemeIcon
                    size="xs"
                    radius="sm"
                    variant="light"
                    color={getStatusColor(getKeyStatus(item))}
                  >
                    <IconKey size={10} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    {item.name}
                  </Text>
                </Group>
                {item.description && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {item.description}
                  </Text>
                )}
              </Stack>
            ),
          },
          token: {
            label: "Key",
            fit: true,
            value: (item) => (
              <Group gap={4}>
                <Code
                  ff="monospace"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.5px",
                  }}
                >
                  {formatKeyPreview(item.tokenPrefix, item.tokenSuffix)}
                </Code>
                <ClipboardButton
                  size="xs"
                  variant="subtle"
                  value={formatKeyPreview(item.tokenPrefix, item.tokenSuffix)}
                />
              </Group>
            ),
          },
          status: {
            label: "Status",
            fit: true,
            value: (item) => {
              const status = getKeyStatus(item);
              return (
                <Badge
                  size="sm"
                  variant="light"
                  color={getStatusColor(status)}
                  leftSection={getStatusIcon(status)}
                >
                  {status.toUpperCase()}
                </Badge>
              );
            },
          },
          roles: {
            label: "Roles",
            value: (item) => (
              <Group gap={4} wrap="wrap">
                {item.roles.length > 0 ? (
                  item.roles.slice(0, 3).map((role) => (
                    <Badge key={role} size="xs" variant="outline" color="gray">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <Text size="xs" c="dimmed">
                    No roles
                  </Text>
                )}
                {item.roles.length > 3 && (
                  <Tooltip label={item.roles.slice(3).join(", ")}>
                    <Badge size="xs" variant="light" color="gray">
                      +{item.roles.length - 3}
                    </Badge>
                  </Tooltip>
                )}
              </Group>
            ),
          },
          usage: {
            label: "Usage",
            fit: true,
            value: (item) => (
              <Stack gap={2}>
                <Text size="xs" ff="monospace" fw={500}>
                  {item.usageCount.toLocaleString()} calls
                </Text>
                {item.lastUsedAt ? (
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">
                      {l(item.lastUsedAt, { date: "fromNow" })}
                    </Text>
                    {item.lastUsedIp && (
                      <Tooltip label={`Last IP: ${item.lastUsedIp}`}>
                        <IconNetwork
                          size={12}
                          color="var(--mantine-color-dimmed)"
                        />
                      </Tooltip>
                    )}
                  </Group>
                ) : (
                  <Text size="xs" c="yellow">
                    Never used
                  </Text>
                )}
              </Stack>
            ),
          },
          userId: {
            label: "Owner",
            fit: true,
            value: (item) => (
              <ActionButton
                variant="subtle"
                size="xs"
                href={router.path("adminUserDetails", {
                  params: { userId: item.userId },
                })}
                leftSection={<IconUser size={12} />}
              >
                <Text size="xs" ff="monospace">
                  {item.userId.slice(0, 8)}
                </Text>
              </ActionButton>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
          expiresAt: {
            label: "Expires",
            fit: true,
            value: (item) => {
              if (!item.expiresAt) {
                return (
                  <Text size="xs" c="dimmed">
                    Never
                  </Text>
                );
              }

              const isExpired = new Date(item.expiresAt) < new Date();
              return (
                <Text size="xs" c={isExpired ? "orange" : "dimmed"}>
                  {l(item.expiresAt, { date: "fromNow" })}
                </Text>
              );
            },
          },
          actions: {
            label: "",
            fit: true,
            value: (item) => {
              const status = getKeyStatus(item);
              if (status === "revoked") {
                return (
                  <Tooltip label="Already revoked">
                    <IconCheck size={14} color="var(--mantine-color-dimmed)" />
                  </Tooltip>
                );
              }

              return (
                <Tooltip label="Revoke key">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => handleRevoke(item)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              );
            },
          },
        }}
      />
    </Flex>
  );
};

export default AdminApiKeys;
