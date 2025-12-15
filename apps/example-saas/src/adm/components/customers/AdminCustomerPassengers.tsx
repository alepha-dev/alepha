import { useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, ThemeIcon } from "@mantine/core";
import {
  IconId,
  IconMail,
  IconPhone,
  IconStar,
  IconUser,
  IconWheelchair,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { CustomerPassenger } from "../../../api/customers/entities/customers.ts";

const AdminCustomerPassengers = () => {
  const state = useRouterState();
  const client = useClient<CustomerController>();
  const { l } = useI18n();
  const customerId = state.params.customerId as string;

  const [passengers, setPassengers] = useState<CustomerPassenger[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPassengers = async () => {
      try {
        const data = await client.getCustomerPassengers({
          params: { customerId },
        });
        setPassengers(data);
      } finally {
        setLoading(false);
      }
    };

    loadPassengers();
  }, [customerId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (passengers.length === 0) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">No saved passengers</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md">
      {passengers.map((passenger) => (
        <Card key={passenger.id} withBorder>
          <Group justify="space-between" align="flex-start">
            <Group>
              <ThemeIcon size="xl" variant="light" color="blue">
                <IconUser size={24} />
              </ThemeIcon>
              <Stack gap={4}>
                <Group gap="xs">
                  <Text size="lg" fw={600}>
                    {passenger.firstName} {passenger.lastName}
                  </Text>
                  {passenger.isDefault && (
                    <Badge
                      size="sm"
                      variant="light"
                      color="green"
                      leftSection={<IconStar size={10} />}
                    >
                      Primary
                    </Badge>
                  )}
                  {passenger.label && (
                    <Badge size="sm" variant="outline" color="gray">
                      {passenger.label}
                    </Badge>
                  )}
                </Group>

                <Group gap="md">
                  {passenger.birthDate && (
                    <Text size="sm" c="dimmed">
                      Born: {l(passenger.birthDate, { date: "short" })}
                    </Text>
                  )}
                  {passenger.nationality && (
                    <Text size="sm" c="dimmed">
                      {passenger.nationality}
                    </Text>
                  )}
                  {passenger.gender && (
                    <Text size="sm" c="dimmed">
                      {passenger.gender.charAt(0).toUpperCase() +
                        passenger.gender.slice(1).replace(/_/g, " ")}
                    </Text>
                  )}
                </Group>

                <Group gap="md" mt="xs">
                  {passenger.email && (
                    <Group gap={4}>
                      <IconMail size={14} color="var(--mantine-color-dimmed)" />
                      <Text size="sm">{passenger.email}</Text>
                    </Group>
                  )}
                  {passenger.phone && (
                    <Group gap={4}>
                      <IconPhone
                        size={14}
                        color="var(--mantine-color-dimmed)"
                      />
                      <Text size="sm">{passenger.phone}</Text>
                    </Group>
                  )}
                </Group>
              </Stack>
            </Group>

            <Stack gap="xs" align="flex-end">
              {passenger.documentType && (
                <Group gap="xs">
                  <IconId size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="sm" c="dimmed">
                    {passenger.documentType
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Text>
                  {passenger.documentNumber && (
                    <Text size="sm" ff="monospace">
                      {passenger.documentNumber}
                    </Text>
                  )}
                </Group>
              )}

              <Group gap="xs">
                {passenger.wheelchairAssistance && (
                  <Badge
                    size="sm"
                    variant="light"
                    color="blue"
                    leftSection={<IconWheelchair size={10} />}
                  >
                    Wheelchair
                  </Badge>
                )}
                {passenger.specialMeals && (
                  <Badge size="sm" variant="light" color="orange">
                    {passenger.specialMeals}
                  </Badge>
                )}
                {passenger.preferredSeatPosition && (
                  <Badge size="sm" variant="outline" color="gray">
                    {passenger.preferredSeatPosition.charAt(0).toUpperCase() +
                      passenger.preferredSeatPosition.slice(1)}
                  </Badge>
                )}
              </Group>
            </Stack>
          </Group>
        </Card>
      ))}
    </Flex>
  );
};

export default AdminCustomerPassengers;
