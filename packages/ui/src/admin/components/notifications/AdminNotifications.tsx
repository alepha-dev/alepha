import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Tooltip } from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconClock,
  IconMail,
  IconMessage,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type {
  AdminNotificationController,
  NotificationEntity,
} from "alepha/api/notifications";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

const AdminNotifications = () => {
  const client = useClient<AdminNotificationController>();
  const { l } = useI18n();

  const filters = t.object({
    type: t.optional(
      t.enum(["email", "sms"], {
        title: "Type",
      }),
    ),
    status: t.optional(
      t.enum(["pending", "sent", "failed"], {
        title: "Status",
      }),
    ),
    template: t.optional(
      t.string({
        title: "Template",
      }),
    ),
    contact: t.optional(
      t.string({
        title: "Contact",
      }),
    ),
  });

  const getStatus = (item: NotificationEntity) => {
    if (item.error) return "failed";
    if (item.sentAt) return "sent";
    return "pending";
  };

  const getStatusBadge = (item: NotificationEntity) => {
    const status = getStatus(item);
    switch (status) {
      case "sent":
        return (
          <Badge
            size="sm"
            variant="light"
            color="green"
            leftSection={<IconCheck size={12} />}
          >
            Sent
          </Badge>
        );
      case "failed":
        return (
          <Tooltip label={item.error?.message} multiline maw={300}>
            <Badge
              size="sm"
              variant="light"
              color="red"
              leftSection={<IconAlertCircle size={12} />}
            >
              Failed
            </Badge>
          </Tooltip>
        );
      default:
        return (
          <Badge
            size="sm"
            variant="light"
            color="yellow"
            leftSection={<IconClock size={12} />}
          >
            Pending
          </Badge>
        );
    }
  };

  return (
    <Flex flex={1} direction="column">
      <DataTable<NotificationEntity, typeof filters>
        submitOnInit
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 4,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
        }}
        onFilterChange={(_key, _value, form) => {
          return form.submit();
        }}
        filters={filters}
        tableTrProps={(item) => {
          const status = getStatus(item);
          if (status === "failed") {
            return {
              bg: "var(--mantine-color-red-light)",
            };
          }
          return {};
        }}
        items={async (filters) => {
          const response = await client.findNotifications({
            query: filters,
          });

          return response as Page<NotificationEntity>;
        }}
        columns={{
          type: {
            label: "Type",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="outline"
                leftSection={
                  item.type === "email" ? (
                    <IconMail size={12} />
                  ) : (
                    <IconMessage size={12} />
                  )
                }
              >
                {item.type.toUpperCase()}
              </Badge>
            ),
          },
          template: {
            label: "Template",
            value: (item) => (
              <Text size="sm" fw={500}>
                {item.template}
              </Text>
            ),
          },
          contact: {
            label: "Contact",
            value: (item) => (
              <Text size="sm" ff="monospace">
                {item.contact}
              </Text>
            ),
          },
          category: {
            label: "Category",
            fit: true,
            value: (item) =>
              item.category ? (
                <Badge size="xs" variant="light">
                  {item.category}
                </Badge>
              ) : (
                <Text size="xs" c="dimmed">
                  -
                </Text>
              ),
          },
          status: {
            label: "Status",
            fit: true,
            value: (item) => getStatusBadge(item),
          },
          sentAt: {
            label: "Sent",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.sentAt ? l(item.sentAt, { date: "fromNow" }) : "-"}
              </Text>
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
        }}
      />
    </Flex>
  );
};

export default AdminNotifications;
