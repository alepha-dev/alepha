import { useClient, useRouterState } from "@alepha/react";
import { Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, ThemeIcon } from "@mantine/core";
import {
  IconBriefcase,
  IconCheck,
  IconCreditCard,
  IconHome,
  IconMapPin,
  IconPhone,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { CustomerAddress } from "../../../api/customers/entities/customers.ts";

const typeIcons: Record<string, typeof IconHome> = {
  billing: IconCreditCard,
  home: IconHome,
  work: IconBriefcase,
  other: IconMapPin,
};

const typeColors: Record<string, string> = {
  billing: "green",
  home: "blue",
  work: "orange",
  other: "gray",
};

const AdminCustomerAddresses = () => {
  const state = useRouterState();
  const client = useClient<CustomerController>();
  const customerId = state.params.customerId as string;

  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAddresses = async () => {
      try {
        const data = await client.getCustomerAddresses({
          params: { customerId },
        });
        setAddresses(data);
      } finally {
        setLoading(false);
      }
    };

    loadAddresses();
  }, [customerId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (addresses.length === 0) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">No saved addresses</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md">
      {addresses.map((address) => {
        const Icon = typeIcons[address.type] || IconMapPin;
        const color = typeColors[address.type] || "gray";

        return (
          <Card key={address.id} withBorder>
            <Group justify="space-between" align="flex-start">
              <Group>
                <ThemeIcon size="xl" variant="light" color={color}>
                  <Icon size={24} />
                </ThemeIcon>
                <Stack gap={4}>
                  <Group gap="xs">
                    <Text size="lg" fw={600}>
                      {address.label ||
                        address.type.charAt(0).toUpperCase() +
                          address.type.slice(1)}
                    </Text>
                    <Badge size="sm" variant="light" color={color}>
                      {address.type.charAt(0).toUpperCase() +
                        address.type.slice(1)}
                    </Badge>
                    {address.isDefaultBilling && (
                      <Badge
                        size="sm"
                        variant="outline"
                        color="green"
                        leftSection={<IconCheck size={10} />}
                      >
                        Default Billing
                      </Badge>
                    )}
                    {address.isDefaultShipping && (
                      <Badge
                        size="sm"
                        variant="outline"
                        color="blue"
                        leftSection={<IconCheck size={10} />}
                      >
                        Default Shipping
                      </Badge>
                    )}
                  </Group>

                  {(address.firstName ||
                    address.lastName ||
                    address.company) && (
                    <Text size="sm" fw={500}>
                      {address.company && (
                        <>
                          {address.company}
                          <br />
                        </>
                      )}
                      {address.firstName} {address.lastName}
                    </Text>
                  )}

                  <Stack gap={2}>
                    <Text size="sm">{address.street}</Text>
                    {address.street2 && (
                      <Text size="sm">{address.street2}</Text>
                    )}
                    <Text size="sm">
                      {address.postalCode} {address.city}
                      {address.state && `, ${address.state}`}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {address.country}
                    </Text>
                  </Stack>

                  {address.phone && (
                    <Group gap={4} mt="xs">
                      <IconPhone
                        size={14}
                        color="var(--mantine-color-dimmed)"
                      />
                      <Text size="sm">{address.phone}</Text>
                    </Group>
                  )}
                </Stack>
              </Group>
            </Group>
          </Card>
        );
      })}
    </Flex>
  );
};

export default AdminCustomerAddresses;
