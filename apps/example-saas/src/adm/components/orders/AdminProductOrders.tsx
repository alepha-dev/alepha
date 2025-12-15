import { useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group, Stack } from "@mantine/core";
import {
  IconCreditCard,
  IconPackage,
  IconReceipt,
  IconShoppingCart,
  IconTicket,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { ProductOrderController } from "../../../api/orders/controllers/ProductOrderController.ts";
import type { ProductOrder } from "../../../api/orders/entities/productOrders.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  pending: "yellow",
  confirmed: "blue",
  processing: "cyan",
  fulfilled: "green",
  partially_fulfilled: "teal",
  cancelled: "gray",
  refunded: "red",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  fulfilled: "Fulfilled",
  partially_fulfilled: "Partial",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const paymentStatusColors: Record<string, string> = {
  pending: "yellow",
  paid: "green",
  failed: "red",
  refunded: "orange",
};

const channelIcons: Record<string, typeof IconShoppingCart> = {
  web: IconShoppingCart,
  mobile: IconShoppingCart,
  station: IconReceipt,
  onboard: IconTicket,
  agent: IconCreditCard,
};

const channelLabels: Record<string, string> = {
  web: "Web",
  mobile: "Mobile",
  station: "Station",
  onboard: "Onboard",
  agent: "Agent",
};

const AdminProductOrders = () => {
  const client = useClient<ProductOrderController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const filters = t.object({
    query: t.optional(t.text()),
    status: t.optional(
      t.enum([
        "pending",
        "confirmed",
        "processing",
        "fulfilled",
        "partially_fulfilled",
        "cancelled",
        "refunded",
      ]),
    ),
    channel: t.optional(
      t.enum(["web", "mobile", "station", "onboard", "agent"]),
    ),
    paymentStatus: t.optional(
      t.enum(["pending", "paid", "failed", "refunded"]),
    ),
    isBookingAddOn: t.optional(t.boolean()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<ProductOrder, typeof filters>
        submitOnInit
        defaultSize={15}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 5,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        onFilterChange={(key, value, form) => {
          return form.submit();
        }}
        filters={filters}
        tableTrProps={(item) => ({
          style: { cursor: "pointer" },
          onClick: () =>
            router.go("adminOrderDetails", {
              params: { orderId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findOrders({
            query: filters,
          });
          return response as Page<ProductOrder>;
        }}
        columns={{
          order: {
            label: "Order",
            value: (item) => (
              <Group gap="sm">
                <IconReceipt size={20} />
                <Stack gap={2}>
                  <Text size="sm" fw={500} ff="monospace">
                    {item.orderNumber}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {item.itemCount} item{item.itemCount !== 1 ? "s" : ""}
                  </Text>
                </Stack>
              </Group>
            ),
          },
          customer: {
            label: "Customer",
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm">{item.customerName || "Guest"}</Text>
                {item.customerEmail && (
                  <Text size="xs" c="dimmed">
                    {item.customerEmail}
                  </Text>
                )}
              </Stack>
            ),
          },
          type: {
            label: "Type",
            fit: true,
            value: (item) => {
              const ChannelIcon = channelIcons[item.channel] || IconPackage;
              return (
                <Group gap="xs">
                  <ChannelIcon size={14} />
                  <Text size="sm">
                    {channelLabels[item.channel] || item.channel}
                  </Text>
                  {item.isBookingAddOn && (
                    <Badge size="xs" variant="light" color="violet">
                      Add-on
                    </Badge>
                  )}
                </Group>
              );
            },
          },
          status: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={statusColors[item.status] || "gray"}
              >
                {statusLabels[item.status] || item.status}
              </Badge>
            ),
          },
          payment: {
            label: "Payment",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="outline"
                color={paymentStatusColors[item.paymentStatus] || "gray"}
              >
                {item.paymentStatus}
              </Badge>
            ),
          },
          total: {
            label: "Total",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={600} ff="monospace">
                {item.currency} {item.total.toFixed(2)}
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

export default AdminProductOrders;
