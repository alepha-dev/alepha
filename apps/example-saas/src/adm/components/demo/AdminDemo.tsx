import { useAction, useClient } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Alert,
  Badge,
  Card,
  Container,
  Grid,
  Group,
  Loader,
  Progress,
  Stack,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArmchair,
  IconCheck,
  IconCreditCard,
  IconDatabase,
  IconDevices,
  IconGift,
  IconId,
  IconMapPin,
  IconMessageCircle,
  IconPercentage,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconRoute,
  IconTicket,
  IconTrain,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { SeedController } from "../../../api/system/controllers/SeedController.ts";

interface Status {
  stations: number;
  trips: number;
  tripInstances: number;
  seatLayouts: number;
  fareClasses: number;
  priceRules: number;
  customers: number;
  vouchers: number;
  agents: number;
  devices: number;
  bookings: number;
  payments: number;
}

interface ResetResult {
  ok: boolean;
  cleared: { tables: number };
  created: {
    seatLayouts: number;
    stations: number;
    trips: number;
    tripInstances: number;
    fareClasses: number;
    priceRules: number;
    vouchers: number;
    agents: number;
    devices: number;
    products: number;
    productOrders: number;
  };
}

interface PopulateResult {
  ok: boolean;
  created: {
    customers: number;
    bookings: number;
    payments: number;
    issues: number;
    issueMessages: number;
    productOrders: number;
  };
}

const StatusCard = ({
  icon: Icon,
  label,
  count,
  color,
}: {
  icon: typeof IconDatabase;
  label: string;
  count: number;
  color: string;
}) => (
  <Card withBorder p="sm">
    <Group gap="sm">
      <ThemeIcon size="md" variant="light" color={color}>
        <Icon size={16} />
      </ThemeIcon>
      <Stack gap={0}>
        <Text size="lg" fw={700}>
          {count.toLocaleString()}
        </Text>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Group>
  </Card>
);

const AdminDemo = () => {
  const client = useClient<SeedController>();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [populateResult, setPopulateResult] = useState<PopulateResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setStatusLoading(true);
    try {
      const data = await client.getStatus({});
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const resetAction = useAction(
    {
      handler: async () => {
        setResult(null);
        setPopulateResult(null);
        setError(null);
        const data = await client.hardReset({});
        setResult(data);
        await loadStatus();
      },
    },
    [],
  );

  const populateAction = useAction(
    {
      handler: async () => {
        setResult(null);
        setPopulateResult(null);
        setError(null);
        const data = await client.populateDatabase({});
        setPopulateResult(data);
        await loadStatus();
      },
    },
    [],
  );

  const isEmpty =
    status &&
    status.stations === 0 &&
    status.trips === 0 &&
    status.seatLayouts === 0;
  const hasData =
    status &&
    (status.stations > 0 ||
      status.trips > 0 ||
      status.tripInstances > 0 ||
      status.bookings > 0);

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        {/* Header */}
        <Flex direction="column" align="center" gap="md">
          <IconDatabase size={48} stroke={1.5} />
          <Title order={1}>Database Management</Title>
          <Text c="dimmed" ta="center" maw={600}>
            Reset the database with a complete AlephaRail demo dataset including
            Canadian stations, trips, seat layouts, agents, devices, and more.
          </Text>
        </Flex>

        {/* Results */}
        {result && (
          <Alert
            icon={<IconCheck size={16} />}
            title="Hard Reset Complete"
            color="green"
          >
            <Stack gap="xs">
              <Text size="sm">
                Successfully cleared {result.cleared.tables} tables and created
                fresh demo data:
              </Text>
              <Group gap="md">
                <Badge variant="light" color="blue">
                  {result.created.stations} stations
                </Badge>
                <Badge variant="light" color="blue">
                  {result.created.trips} trips
                </Badge>
                <Badge variant="light" color="blue">
                  {result.created.tripInstances} instances
                </Badge>
                <Badge variant="light" color="violet">
                  {result.created.agents} agents
                </Badge>
                <Badge variant="light" color="orange">
                  {result.created.devices} devices
                </Badge>
                <Badge variant="light" color="green">
                  {result.created.products} products
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Agent accounts created with password: Demo1234!
              </Text>
            </Stack>
          </Alert>
        )}

        {populateResult && (
          <Alert
            icon={<IconCheck size={16} />}
            title="Database Populated"
            color="green"
          >
            <Stack gap="xs">
              <Text size="sm">Successfully created fake data for testing:</Text>
              <Group gap="md">
                <Badge variant="light" color="green">
                  {populateResult.created.customers} customers
                </Badge>
                <Badge variant="light" color="pink">
                  {populateResult.created.bookings} bookings
                </Badge>
                <Badge variant="light" color="pink">
                  {populateResult.created.payments} payments
                </Badge>
                <Badge variant="light" color="orange">
                  {populateResult.created.issues} issues
                </Badge>
                <Badge variant="light" color="orange">
                  {populateResult.created.issueMessages} messages
                </Badge>
                <Badge variant="light" color="blue">
                  {populateResult.created.productOrders} orders
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                All fake customers have password: Demo1234!
              </Text>
            </Stack>
          </Alert>
        )}

        {error && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            title="Error"
            color="red"
          >
            {error}
          </Alert>
        )}

        {/* Current Status */}
        <Card withBorder p="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <Group gap="xs">
                <IconDatabase size={20} />
                <Text fw={600}>Current Database Status</Text>
              </Group>
              <ActionButton
                variant="subtle"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={loadStatus}
                loading={statusLoading}
              >
                Refresh
              </ActionButton>
            </Group>

            {statusLoading && !status ? (
              <Flex justify="center" py="md">
                <Loader size="sm" />
              </Flex>
            ) : status ? (
              <Grid>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconMapPin}
                    label="Stations"
                    count={status.stations}
                    color="blue"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconRoute}
                    label="Trips"
                    count={status.trips}
                    color="blue"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconTrain}
                    label="Trip Instances"
                    count={status.tripInstances}
                    color="cyan"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconArmchair}
                    label="Seat Layouts"
                    count={status.seatLayouts}
                    color="cyan"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconReceipt}
                    label="Fare Classes"
                    count={status.fareClasses}
                    color="violet"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconPercentage}
                    label="Price Rules"
                    count={status.priceRules}
                    color="violet"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconUsers}
                    label="Customers"
                    count={status.customers}
                    color="green"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconGift}
                    label="Vouchers"
                    count={status.vouchers}
                    color="green"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconId}
                    label="Agents"
                    count={status.agents}
                    color="orange"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconDevices}
                    label="Devices"
                    count={status.devices}
                    color="orange"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconTicket}
                    label="Bookings"
                    count={status.bookings}
                    color="pink"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                  <StatusCard
                    icon={IconCreditCard}
                    label="Payments"
                    count={status.payments}
                    color="pink"
                  />
                </Grid.Col>
              </Grid>
            ) : null}

            {isEmpty && (
              <Alert icon={<IconDatabase size={16} />} color="yellow">
                Database is empty. Click "Hard Reset" to populate with demo
                data.
              </Alert>
            )}
          </Stack>
        </Card>

        {/* Hard Reset */}
        <Card withBorder p="lg">
          <Stack gap="md">
            <Group gap="xs">
              <IconAlertTriangle size={20} color="var(--mantine-color-red-6)" />
              <Text fw={600} c="red.7">
                Hard Reset
              </Text>
            </Group>

            <Text size="sm">
              This will <strong>delete all existing data</strong> and create a
              fresh demo dataset with:
            </Text>

            <Grid>
              <Grid.Col span={6}>
                <Stack gap="xs">
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">3 seat layouts (train configurations)</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">13 stations across Canada</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">23 trip routes</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">30 days of trip instances</Text>
                  </Group>
                </Stack>
              </Grid.Col>
              <Grid.Col span={6}>
                <Stack gap="xs">
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">5 fare classes with quotas</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">3 dynamic pricing rules</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">1 admin account (Demo1234!)</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">12 devices (gates, TVMs, validators)</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">11 Canadian-themed products</Text>
                  </Group>
                </Stack>
              </Grid.Col>
            </Grid>

            {resetAction.loading && (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  Resetting database... this may take a minute.
                </Text>
                <Progress value={100} animated />
              </Stack>
            )}

            <ActionButton
              color="red"
              size="lg"
              fullWidth
              leftSection={<IconRefresh size={18} />}
              onClick={resetAction.run}
              loading={resetAction.loading}
            >
              {hasData ? "Hard Reset Database" : "Initialize Demo Data"}
            </ActionButton>
          </Stack>
        </Card>

        {/* Populate Database */}
        <Card withBorder p="lg">
          <Stack gap="md">
            <Group gap="xs">
              <IconPlus size={20} color="var(--mantine-color-blue-6)" />
              <Text fw={600} c="blue.7">
                Populate Database
              </Text>
            </Group>

            <Text size="sm">
              Add fake customer data and transactions to an existing database.
              This will <strong>not delete</strong> existing data, only add new
              records:
            </Text>

            <Grid>
              <Grid.Col span={6}>
                <Stack gap="xs">
                  <Group gap="xs">
                    <IconUsers size={14} color="var(--mantine-color-green-6)" />
                    <Text size="sm">50 customers with accounts</Text>
                  </Group>
                  <Group gap="xs">
                    <IconTicket size={14} color="var(--mantine-color-pink-6)" />
                    <Text size="sm">100 bookings with payments</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCreditCard
                      size={14}
                      color="var(--mantine-color-pink-6)"
                    />
                    <Text size="sm">Payment records (card, PayPal, etc.)</Text>
                  </Group>
                </Stack>
              </Grid.Col>
              <Grid.Col span={6}>
                <Stack gap="xs">
                  <Group gap="xs">
                    <IconMessageCircle
                      size={14}
                      color="var(--mantine-color-orange-6)"
                    />
                    <Text size="sm">30 support issues with messages</Text>
                  </Group>
                  <Group gap="xs">
                    <IconReceipt
                      size={14}
                      color="var(--mantine-color-blue-6)"
                    />
                    <Text size="sm">40 product orders</Text>
                  </Group>
                  <Group gap="xs">
                    <IconCheck size={14} color="var(--mantine-color-gray-6)" />
                    <Text size="sm">Dates from last 2 months</Text>
                  </Group>
                </Stack>
              </Grid.Col>
            </Grid>

            {populateAction.loading && (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  Populating database with fake data... this may take a minute.
                </Text>
                <Progress value={100} animated color="blue" />
              </Stack>
            )}

            <ActionButton
              color="blue"
              size="lg"
              fullWidth
              leftSection={<IconPlus size={18} />}
              onClick={populateAction.run}
              loading={populateAction.loading}
              disabled={!!isEmpty}
            >
              Populate Database
            </ActionButton>

            {isEmpty && (
              <Text size="xs" c="dimmed" ta="center">
                Run "Hard Reset" first to create the base data structure.
              </Text>
            )}
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
};

export default AdminDemo;
