import {
  ActionButton,
  ClipboardButton,
  DataTable,
  Flex,
  StatCards,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Badge, Code, Tooltip } from "@mantine/core";
import {
  IconCheck,
  IconClock,
  IconKey,
  IconNetwork,
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

const formatKeyPreview = (prefix: string, suffix: string) => {
  return `${prefix}...${suffix}`;
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
    <Flex p="md" flex={1} direction="column" gap="md">
      <StatCards
        items={[
          { label: "Total Keys", value: stats.total, icon: IconKey },
          { label: "Active", value: stats.active, icon: IconCheck },
          { label: "Revoked", value: stats.revoked, icon: IconTrash },
          { label: "Never Used", value: stats.neverUsed, icon: IconClock },
        ]}
      />

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
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={filters}
        tableTrProps={(item) => {
          const status = getKeyStatus(item);
          if (status === "revoked") {
            return { opacity: 0.6 };
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
              <Flex direction="column" gap={2}>
                <Text size="sm" fw={600}>
                  {item.name}
                </Text>
                {item.description && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {item.description}
                  </Text>
                )}
              </Flex>
            ),
          },
          token: {
            label: "Key",
            value: (item) => (
              <Flex gap={4}>
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
              </Flex>
            ),
          },
          status: {
            label: "Status",
            value: (item) => {
              const status = getKeyStatus(item);
              return (
                <Badge
                  size="sm"
                  variant="light"
                  color={
                    status === "active"
                      ? "green"
                      : status === "expired"
                        ? "yellow"
                        : "red"
                  }
                >
                  {status}
                </Badge>
              );
            },
          },
          roles: {
            label: "Roles",
            value: (item) => (
              <Flex gap={4} wrap="wrap">
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
              </Flex>
            ),
          },
          usage: {
            label: "Usage",
            value: (item) => (
              <Flex direction="column" gap={2}>
                <Text size="xs" ff="monospace" fw={500}>
                  {item.usageCount.toLocaleString()} calls
                </Text>
                {item.lastUsedAt ? (
                  <Flex gap={4}>
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
                  </Flex>
                ) : (
                  <Text size="xs" c="dimmed">
                    Never used
                  </Text>
                )}
              </Flex>
            ),
          },
          userId: {
            label: "Owner",
            value: (item) => (
              <ActionButton
                variant="subtle"
                size="xs"
                href={router.path("adminUserProfile", {
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
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
          expiresAt: {
            label: "Expires",
            value: (item) => {
              if (!item.expiresAt) {
                return (
                  <Text size="xs" c="dimmed">
                    Never
                  </Text>
                );
              }

              return (
                <Text size="xs" c="dimmed">
                  {l(item.expiresAt, { date: "fromNow" })}
                </Text>
              );
            },
          },
        }}
        rowActions={(item) => [
          {
            label: "Revoke key",
            icon: IconTrash,
            color: "red",
            onClick: () => handleRevoke(item),
            visible: getKeyStatus(item) === "active",
          },
        ]}
      />
    </Flex>
  );
};

export default AdminApiKeys;
