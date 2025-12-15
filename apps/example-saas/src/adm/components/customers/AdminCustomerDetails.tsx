import { useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  Progress,
  Stack,
  ThemeIcon,
} from "@mantine/core";
import {
  IconCalendar,
  IconCreditCard,
  IconMail,
  IconPhone,
  IconStar,
  IconTicket,
  IconWorld,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { Customer } from "../../../api/customers/entities/customers.ts";

const tierThresholds = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
  platinum: 10000,
};

const tierColors: Record<string, string> = {
  bronze: "orange",
  silver: "gray",
  gold: "yellow",
  platinum: "violet",
};

const AdminCustomerDetails = () => {
  const state = useRouterState();
  const client = useClient<CustomerController>();
  const { l } = useI18n();
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

  const getNextTier = (currentTier: string) => {
    const tiers = ["bronze", "silver", "gold", "platinum"];
    const currentIndex = tiers.indexOf(currentTier);
    return currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;
  };

  const nextTier = getNextTier(customer.loyaltyTier);
  const nextTierThreshold = nextTier
    ? tierThresholds[nextTier as keyof typeof tierThresholds]
    : null;
  const progressToNextTier = nextTierThreshold
    ? Math.min((customer.loyaltyPointsLifetime / nextTierThreshold) * 100, 100)
    : 100;

  return (
    <Flex flex={1} direction="column" gap="md">
      <Grid>
        {/* Loyalty Status Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Loyalty Status</Text>
                <Badge
                  size="lg"
                  variant="light"
                  color={tierColors[customer.loyaltyTier]}
                  leftSection={<IconStar size={14} />}
                >
                  {customer.loyaltyTier.charAt(0).toUpperCase() +
                    customer.loyaltyTier.slice(1)}
                </Badge>
              </Group>

              <Grid>
                <Grid.Col span={6}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">
                      Available Points
                    </Text>
                    <Text size="xl" fw={700} c="blue">
                      {customer.loyaltyPoints.toLocaleString()}
                    </Text>
                  </Stack>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">
                      Lifetime Points
                    </Text>
                    <Text size="xl" fw={700}>
                      {customer.loyaltyPointsLifetime.toLocaleString()}
                    </Text>
                  </Stack>
                </Grid.Col>
              </Grid>

              {nextTier && (
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Progress to{" "}
                      {nextTier.charAt(0).toUpperCase() + nextTier.slice(1)}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {customer.loyaltyPointsLifetime.toLocaleString()} /{" "}
                      {nextTierThreshold?.toLocaleString()}
                    </Text>
                  </Group>
                  <Progress
                    value={progressToNextTier}
                    color={tierColors[nextTier]}
                    size="md"
                  />
                </Stack>
              )}

              {customer.loyaltyNumber && (
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    Loyalty Number:
                  </Text>
                  <Text size="sm" fw={500} ff="monospace">
                    {customer.loyaltyNumber}
                  </Text>
                </Group>
              )}

              {customer.loyaltyJoinedAt && (
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    Member since:
                  </Text>
                  <Text size="sm">
                    {l(customer.loyaltyJoinedAt, { date: "long" })}
                  </Text>
                </Group>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Statistics Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Statistics</Text>

              <Grid>
                <Grid.Col span={6}>
                  <Group gap="sm">
                    <ThemeIcon size="lg" variant="light" color="blue">
                      <IconTicket size={18} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text size="lg" fw={600}>
                        {customer.totalBookings}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Total Bookings
                      </Text>
                    </Stack>
                  </Group>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Group gap="sm">
                    <ThemeIcon size="lg" variant="light" color="green">
                      <IconCreditCard size={18} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text size="lg" fw={600}>
                        €{customer.totalSpent.toFixed(2)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Total Spent
                      </Text>
                    </Stack>
                  </Group>
                </Grid.Col>
              </Grid>

              {customer.lastBookingAt && (
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    Last booking:
                  </Text>
                  <Text size="sm">
                    {l(customer.lastBookingAt, { date: "fromNow" })}
                  </Text>
                </Group>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Profile Information Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Profile Information</Text>

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconCalendar size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Birth Date
                  </Text>
                  <Text size="sm">
                    {customer.birthDate
                      ? l(customer.birthDate, { date: "long" })
                      : "—"}
                  </Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconWorld size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Nationality
                  </Text>
                  <Text size="sm">{customer.nationality || "—"}</Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconPhone size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Phone
                  </Text>
                  <Text size="sm">{customer.phone || "—"}</Text>
                </Group>

                {customer.gender && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconWorld size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Gender
                    </Text>
                    <Text size="sm">
                      {customer.gender.charAt(0).toUpperCase() +
                        customer.gender.slice(1).replace(/_/g, " ")}
                    </Text>
                  </Group>
                )}
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Preferences Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Preferences</Text>

              <Stack gap="sm">
                <Group gap="sm">
                  <Text size="sm" c="dimmed" w={140}>
                    Preferred Seat
                  </Text>
                  <Text size="sm">
                    {customer.preferredSeatPosition
                      ? customer.preferredSeatPosition.charAt(0).toUpperCase() +
                        customer.preferredSeatPosition.slice(1)
                      : "Any"}
                  </Text>
                </Group>

                <Group gap="sm">
                  <Text size="sm" c="dimmed" w={140}>
                    Preferred Class
                  </Text>
                  <Text size="sm">
                    {customer.preferredClass
                      ? customer.preferredClass.charAt(0).toUpperCase() +
                        customer.preferredClass.slice(1)
                      : "Any"}
                  </Text>
                </Group>

                <Group gap="sm">
                  <Text size="sm" c="dimmed" w={140}>
                    Language
                  </Text>
                  <Text size="sm">
                    {customer.preferredLanguage?.toUpperCase() || "—"}
                  </Text>
                </Group>

                <Group gap="sm">
                  <Text size="sm" c="dimmed" w={140}>
                    Currency
                  </Text>
                  <Text size="sm">
                    {customer.preferredCurrency?.toUpperCase() || "—"}
                  </Text>
                </Group>
              </Stack>

              <Stack gap="xs" mt="xs">
                <Text size="sm" fw={500}>
                  Communication
                </Text>
                <Group gap="xs">
                  <Badge
                    size="sm"
                    variant={customer.marketingEmails ? "filled" : "outline"}
                    color={customer.marketingEmails ? "green" : "gray"}
                    leftSection={<IconMail size={10} />}
                  >
                    Marketing Emails
                  </Badge>
                  <Badge
                    size="sm"
                    variant={customer.marketingSms ? "filled" : "outline"}
                    color={customer.marketingSms ? "green" : "gray"}
                    leftSection={<IconPhone size={10} />}
                  >
                    Marketing SMS
                  </Badge>
                  <Badge
                    size="sm"
                    variant={customer.tripReminders ? "filled" : "outline"}
                    color={customer.tripReminders ? "green" : "gray"}
                  >
                    Trip Reminders
                  </Badge>
                </Group>
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Flex>
  );
};

export default AdminCustomerDetails;
