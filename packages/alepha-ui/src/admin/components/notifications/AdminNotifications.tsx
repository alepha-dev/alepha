import type { DetailListItem } from "@alepha/ui";
import {
  ActionButton,
  DataTable,
  DetailList,
  Flex,
  Text,
  useToast,
} from "@alepha/ui";
import { Badge, Code, Paper } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type {
  AdminNotificationController,
  NotificationDetailResource,
  NotificationResource,
} from "alepha/api/notifications";
import type { LogEntry } from "alepha/logger";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────

const formatDuration = (
  start: Date | string,
  end?: Date | string | null,
): string => {
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const duration = endTime - startTime;

  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
  if (duration < 3600000)
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  return `${Math.floor(duration / 3600000)}h ${Math.floor((duration % 3600000) / 60000)}m`;
};

// ─────────────────────────────────────────────────────────────────────────────

const notificationFilters = t.object({
  status: t.optional(
    t.enum([
      "pending",
      "scheduled",
      "retrying",
      "running",
      "completed",
      "failed",
      "dead",
      "cancelled",
    ]),
  ),
});

// ─────────────────────────────────────────────────────────────────────────────

const AdminNotifications = () => {
  const client = useClient<AdminNotificationController>();
  const { l } = useI18n();

  return (
    <Flex p="md" flex={1} direction="column" gap="md">
      <DataTable<NotificationResource, typeof notificationFilters>
        submitOnInit
        defaultSize={20}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "sm",
          verticalSpacing: "sm",
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={notificationFilters}
        defaultFilters={["status"]}
        items={async (filters) => {
          const response = await client.findNotifications({
            query: { ...filters },
          });
          return response as Page<NotificationResource>;
        }}
        columns={{
          status: {
            label: "Status",
            value: (item) => {
              const color =
                item.status === "completed"
                  ? "green"
                  : item.status === "running"
                    ? "blue"
                    : item.status === "failed" || item.status === "dead"
                      ? "red"
                      : item.status === "cancelled"
                        ? "yellow"
                        : "gray";
              return (
                <Badge size="sm" variant="light" color={color}>
                  {item.status}
                </Badge>
              );
            },
          },
          template: {
            label: "Template",
            value: (item) => (
              <Text size="sm" fw={500} ff="monospace">
                {item.template ?? "\u2014"}
              </Text>
            ),
          },
          type: {
            label: "Type",
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={item.type === "email" ? "blue" : "teal"}
              >
                {item.type ?? "\u2014"}
              </Badge>
            ),
          },
          contact: {
            label: "Contact",
            value: (item) => (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {item.contact ?? "\u2014"}
              </Text>
            ),
          },
          category: {
            label: "Category",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.category ?? "\u2014"}
              </Text>
            ),
          },
          flags: {
            label: "Flags",
            defaultHidden: true,
            value: (item) => (
              <Flex gap={4}>
                {item.critical && (
                  <Badge size="xs" variant="light" color="red">
                    critical
                  </Badge>
                )}
                {item.sensitive && (
                  <Badge size="xs" variant="light" color="orange">
                    sensitive
                  </Badge>
                )}
                {!item.critical && !item.sensitive && (
                  <Text size="xs" c="dimmed">
                    {"\u2014"}
                  </Text>
                )}
              </Flex>
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
          duration: {
            label: "Duration",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.startedAt &&
                (item.completedAt || item.status === "running")
                  ? formatDuration(item.startedAt, item.completedAt)
                  : "\u2014"}
              </Text>
            ),
          },
          error: {
            label: "Error",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {item.error ?? "\u2014"}
              </Text>
            ),
          },
        }}
        panel={{
          can: (item) => Boolean(item.error),
          render: (item) => (
            <Flex direction="column" gap="sm" p="sm">
              {item.error && (
                <Flex direction="column" gap={2}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Error
                  </Text>
                  <Paper p="xs" radius="sm" withBorder>
                    <Text
                      size="sm"
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.error}
                    </Text>
                  </Paper>
                </Flex>
              )}
            </Flex>
          ),
        }}
        drawer={(item) => <NotificationDetailContent item={item} />}
      />
    </Flex>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const NotificationDetailContent = ({
  item,
}: {
  item: NotificationResource;
}) => {
  const client = useClient<AdminNotificationController>();
  const { l } = useI18n();
  const toast = useToast();
  const [detail, setDetail] = useState<NotificationDetailResource | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetail(null);
      setLoading(true);
      try {
        const data = await client.getNotification({ params: { id } });
        setDetail(data);
      } catch {
        toast.danger("Failed to load notification details");
      } finally {
        setLoading(false);
      }
    },
    [client, toast],
  );

  useEffect(() => {
    loadDetail(item.id);
  }, [item.id, loadDetail]);

  if (loading) {
    return (
      <Flex align="center" justify="center" py="xl">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (!detail) return null;

  const rendered = detail.rendered as Record<string, unknown> | undefined;

  const detailItems: DetailListItem[] = [
    {
      label: "ID",
      value: (
        <Text size="sm" ff="monospace">
          {detail.id}
        </Text>
      ),
      copyable: detail.id,
    },
    {
      label: "Status",
      value: (
        <Text size="sm" tt="capitalize">
          {detail.status}
        </Text>
      ),
    },
    {
      label: "Template",
      value: (
        <Text size="sm" ff="monospace">
          {detail.template}
        </Text>
      ),
    },
    {
      label: "Type",
      value: (
        <Badge
          size="sm"
          variant="light"
          color={detail.type === "email" ? "blue" : "teal"}
        >
          {detail.type}
        </Badge>
      ),
    },
    {
      label: "Contact",
      value: detail.contact,
    },
    {
      label: "Category",
      value: detail.category,
      hidden: !detail.category,
    },
    {
      label: "Critical",
      value: detail.critical ? "Yes" : "No",
      hidden: !detail.critical,
    },
    {
      label: "Sensitive",
      value: detail.sensitive ? "Yes" : "No",
      hidden: !detail.sensitive,
    },
    {
      label: "Created",
      value: String(l(detail.createdAt, { date: "lll" })),
    },
    {
      label: "Started",
      value: detail.startedAt
        ? String(l(detail.startedAt, { date: "lll" }))
        : undefined,
      hidden: !detail.startedAt,
    },
    {
      label: "Duration",
      value:
        detail.startedAt &&
        (detail.completedAt || detail.status === "running") ? (
          <Text size="sm" ff="monospace">
            {formatDuration(detail.startedAt, detail.completedAt)}
          </Text>
        ) : undefined,
      hidden: !(
        detail.startedAt &&
        (detail.completedAt || detail.status === "running")
      ),
    },
  ];

  return (
    <Flex direction="column" gap="md">
      {/* Header */}
      <Flex align="center" gap="sm">
        <Text fw={600} ff="monospace">
          {detail.template}
        </Text>
        <Badge
          size="sm"
          variant="light"
          color={detail.type === "email" ? "blue" : "teal"}
        >
          {detail.type}
        </Badge>
        <Text size="sm" tt="capitalize" c="dimmed">
          {detail.status}
        </Text>
      </Flex>

      {/* Actions */}
      <Flex gap="xs">
        <ActionButton
          tooltip="Refresh"
          variant="light"
          size="xs"
          icon={IconRefresh}
          onClick={() => loadDetail(item.id)}
        />
      </Flex>

      {/* Details */}
      <Paper p="sm" radius="md" withBorder>
        <Text size="sm" fw={600} mb="xs">
          Details
        </Text>
        <DetailList items={detailItems} columns={2} />
      </Paper>

      {/* Rendered Content */}
      {rendered && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Content
          </Text>
          {rendered.type === "email" && (
            <Flex direction="column" gap="xs">
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  To
                </Text>
                <Text size="sm">{String(rendered.to ?? "")}</Text>
              </Flex>
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Subject
                </Text>
                <Text size="sm">{String(rendered.subject ?? "")}</Text>
              </Flex>
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Body
                </Text>
                <Paper p="xs" radius="sm" withBorder>
                  <Text
                    size="sm"
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {String(rendered.body ?? "")}
                  </Text>
                </Paper>
              </Flex>
            </Flex>
          )}
          {rendered.type === "sms" && (
            <Flex direction="column" gap="xs">
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  To
                </Text>
                <Text size="sm">{String(rendered.to ?? "")}</Text>
              </Flex>
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Message
                </Text>
                <Paper p="xs" radius="sm" withBorder>
                  <Text
                    size="sm"
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {String(rendered.message ?? "")}
                  </Text>
                </Paper>
              </Flex>
            </Flex>
          )}
        </Paper>
      )}

      {/* Variables */}
      {detail.variables && Object.keys(detail.variables).length > 0 && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Variables
          </Text>
          <Code block>{JSON.stringify(detail.variables, null, 2)}</Code>
        </Paper>
      )}

      {/* Error */}
      {detail.error && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Error
          </Text>
          <Paper p="xs" radius="sm" withBorder>
            <Text
              size="sm"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {detail.error}
            </Text>
          </Paper>
        </Paper>
      )}

      {/* Logs */}
      {detail.logs && detail.logs.length > 0 && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Logs ({detail.logs.length})
          </Text>
          <Flex
            direction="column"
            style={{ maxHeight: 300, overflowY: "auto" }}
          >
            {detail.logs.map((log: LogEntry, i: number) => (
              <Flex key={i} gap="sm" py={2}>
                <Badge size="xs" variant="default">
                  {log.level}
                </Badge>
                <Text size="xs" c="dimmed" ff="monospace">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </Text>
                <Text size="xs">{log.message}</Text>
              </Flex>
            ))}
          </Flex>
        </Paper>
      )}
    </Flex>
  );
};

export default AdminNotifications;
