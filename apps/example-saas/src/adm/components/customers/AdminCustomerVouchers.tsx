import { useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, ThemeIcon } from "@mantine/core";
import {
  IconCalendar,
  IconCheck,
  IconGift,
  IconPercentage,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { Voucher } from "../../../api/customers/entities/vouchers.ts";

const statusColors: Record<string, string> = {
  active: "green",
  used: "blue",
  expired: "gray",
  revoked: "red",
};

const statusIcons: Record<string, typeof IconCheck> = {
  active: IconGift,
  used: IconCheck,
  expired: IconCalendar,
  revoked: IconX,
};

const typeLabels: Record<string, string> = {
  percentage: "% Off",
  fixed_amount: "Fixed",
  free_upgrade: "Upgrade",
  free_seat_selection: "Free Seat",
  points_multiplier: "Points Boost",
};

const AdminCustomerVouchers = () => {
  const state = useRouterState();
  const client = useClient<CustomerController>();
  const { l } = useI18n();
  const customerId = state.params.customerId as string;

  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadVouchers = async () => {
      try {
        const data = await client.getCustomerVouchers({
          params: { customerId },
        });
        setVouchers(data);
      } finally {
        setLoading(false);
      }
    };

    loadVouchers();
  }, [customerId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (vouchers.length === 0) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">No vouchers</Text>
      </Flex>
    );
  }

  const formatValue = (voucher: Voucher) => {
    switch (voucher.type) {
      case "percentage":
        return `${voucher.value}%`;
      case "fixed_amount":
        return `€${voucher.value.toFixed(2)}`;
      case "points_multiplier":
        return `${voucher.value}x`;
      default:
        return "Free";
    }
  };

  return (
    <Flex flex={1} direction="column" gap="md">
      {vouchers.map((voucher) => {
        const StatusIcon = statusIcons[voucher.status] || IconGift;

        return (
          <Card key={voucher.id} withBorder>
            <Group justify="space-between" align="flex-start">
              <Group>
                <ThemeIcon
                  size="xl"
                  variant="light"
                  color={statusColors[voucher.status]}
                >
                  <StatusIcon size={24} />
                </ThemeIcon>
                <Stack gap={4}>
                  <Group gap="xs">
                    <Text size="lg" fw={600}>
                      {voucher.name}
                    </Text>
                    <Badge
                      size="sm"
                      variant="light"
                      color={statusColors[voucher.status]}
                    >
                      {voucher.status.charAt(0).toUpperCase() +
                        voucher.status.slice(1)}
                    </Badge>
                    <Badge size="sm" variant="outline" color="gray">
                      {voucher.source.charAt(0).toUpperCase() +
                        voucher.source.slice(1)}
                    </Badge>
                  </Group>

                  <Group gap="xs">
                    <Text size="sm" ff="monospace" fw={500} c="blue">
                      {voucher.code}
                    </Text>
                    {voucher.description && (
                      <>
                        <Text size="sm" c="dimmed">
                          •
                        </Text>
                        <Text size="sm" c="dimmed">
                          {voucher.description}
                        </Text>
                      </>
                    )}
                  </Group>

                  <Group gap="md" mt="xs">
                    <Group gap={4}>
                      <IconCalendar
                        size={14}
                        color="var(--mantine-color-dimmed)"
                      />
                      <Text size="sm" c="dimmed">
                        Valid: {l(voucher.validFrom, { date: "short" })} -{" "}
                        {l(voucher.validUntil, { date: "short" })}
                      </Text>
                    </Group>

                    {voucher.usedAt && (
                      <Group gap={4}>
                        <IconCheck
                          size={14}
                          color="var(--mantine-color-green-6)"
                        />
                        <Text size="sm" c="dimmed">
                          Used: {l(voucher.usedAt, { date: "short" })}
                        </Text>
                      </Group>
                    )}
                  </Group>
                </Stack>
              </Group>

              <Stack gap="xs" align="flex-end">
                <Group gap="xs">
                  <Badge
                    size="lg"
                    variant="filled"
                    color={voucher.status === "active" ? "pink" : "gray"}
                    leftSection={<IconPercentage size={14} />}
                  >
                    {formatValue(voucher)} {typeLabels[voucher.type]}
                  </Badge>
                </Group>

                {voucher.minPurchase && (
                  <Text size="xs" c="dimmed">
                    Min. €{voucher.minPurchase.toFixed(2)}
                  </Text>
                )}

                {voucher.maxDiscount && (
                  <Text size="xs" c="dimmed">
                    Max. €{voucher.maxDiscount.toFixed(2)}
                  </Text>
                )}

                <Text size="xs" c="dimmed">
                  {voucher.currentUses} / {voucher.maxUses} uses
                </Text>
              </Stack>
            </Group>
          </Card>
        );
      })}
    </Flex>
  );
};

export default AdminCustomerVouchers;
