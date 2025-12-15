import {
  NestedView,
  useClient,
  useRouter,
  useRouterState,
} from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, Tabs } from "@mantine/core";
import {
  IconGift,
  IconHome,
  IconStar,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { Customer } from "../../../api/customers/entities/customers.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const tierColors: Record<string, string> = {
  bronze: "orange",
  silver: "gray",
  gold: "yellow",
  platinum: "violet",
};

const AdminCustomerLayout = () => {
  const router = useRouter<AdmRouter>();
  const state = useRouterState();
  const client = useClient<CustomerController>();
  const customerId = state.params.customerId as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCustomer = async () => {
      try {
        const data = await client.getCustomer({
          params: { id: customerId },
        });
        setCustomer(data);
      } finally {
        setLoading(false);
      }
    };

    loadCustomer();
  }, [customerId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!customer) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Customer not found</Text>
      </Flex>
    );
  }

  const currentPath = state.url.pathname;
  const detailsPath = router.path("adminCustomerDetails", {
    params: { customerId },
  });
  const passengersPath = router.path("adminCustomerPassengers", {
    params: { customerId },
  });
  const addressesPath = router.path("adminCustomerAddresses", {
    params: { customerId },
  });
  const vouchersPath = router.path("adminCustomerVouchers", {
    params: { customerId },
  });

  const getActiveTab = () => {
    if (currentPath.includes("/passengers")) return "passengers";
    if (currentPath.includes("/addresses")) return "addresses";
    if (currentPath.includes("/vouchers")) return "vouchers";
    return "details";
  };
  const activeTab = getActiveTab();

  const customerName =
    customer.firstName || customer.lastName
      ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim()
      : "Unnamed Customer";

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group justify="space-between">
          <Group>
            <IconUser size={32} color="var(--mantine-color-blue-6)" />
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="lg" fw={600}>
                  {customerName}
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={tierColors[customer.loyaltyTier] || "gray"}
                  leftSection={<IconStar size={12} />}
                >
                  {customer.loyaltyTier.charAt(0).toUpperCase() +
                    customer.loyaltyTier.slice(1)}
                </Badge>
              </Group>
              <Group gap="xs">
                {customer.phone && (
                  <Text size="sm" c="dimmed">
                    {customer.phone}
                  </Text>
                )}
                {customer.loyaltyNumber && (
                  <>
                    <Text size="sm" c="dimmed">
                      •
                    </Text>
                    <Text size="sm" c="dimmed" ff="monospace">
                      {customer.loyaltyNumber}
                    </Text>
                  </>
                )}
              </Group>
            </Stack>
          </Group>
          <Stack gap={4} align="flex-end">
            <Text size="xl" fw={700} c="blue">
              {customer.loyaltyPoints.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              loyalty points
            </Text>
          </Stack>
        </Group>
      </Card>

      <Tabs value={activeTab}>
        <Tabs.List>
          <ActionButton
            href={detailsPath}
            leftSection={<IconUser size={16} />}
            c={activeTab === "details" ? undefined : "dimmed"}
            fw={activeTab === "details" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "details"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Profile
          </ActionButton>
          <ActionButton
            href={passengersPath}
            leftSection={<IconUsers size={16} />}
            c={activeTab === "passengers" ? undefined : "dimmed"}
            fw={activeTab === "passengers" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "passengers"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Passengers
          </ActionButton>
          <ActionButton
            href={addressesPath}
            leftSection={<IconHome size={16} />}
            c={activeTab === "addresses" ? undefined : "dimmed"}
            fw={activeTab === "addresses" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "addresses"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Addresses
          </ActionButton>
          <ActionButton
            href={vouchersPath}
            leftSection={<IconGift size={16} />}
            c={activeTab === "vouchers" ? undefined : "dimmed"}
            fw={activeTab === "vouchers" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "vouchers"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Vouchers
          </ActionButton>
        </Tabs.List>
      </Tabs>

      <Flex flex={1}>
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default AdminCustomerLayout;
