import { useClient } from "@alepha/react";
import { useAuth } from "@alepha/react/auth";
import {
  Badge,
  Card,
  Flex,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArmchair,
  IconChartBar,
  IconDevices,
  IconGift,
  IconId,
  IconMapPin,
  IconPackage,
  IconReceipt,
  IconRoute,
  IconTicket,
  IconTrain,
  IconTrendingUp,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { SeedController } from "../../../api/system/controllers/SeedController.ts";

interface DashboardStats {
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
  products: number;
  productOrders: number;
  bookings: number;
  payments: number;
  issues: number;
}

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}

const StatCard = ({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
}: StatCardProps) => (
  <Paper withBorder p="md" radius="md">
    <Group justify="space-between">
      <Stack gap={0}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {title}
        </Text>
        <Text fw={700} size="xl">
          {value.toLocaleString()}
        </Text>
        {subtitle && (
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        )}
      </Stack>
      <ThemeIcon color={color} variant="light" size={48} radius="md">
        <Icon size={24} stroke={1.5} />
      </ThemeIcon>
    </Group>
  </Paper>
);

interface MiniStatProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}

const MiniStat = ({ label, value, icon: Icon, color }: MiniStatProps) => (
  <Group gap="xs">
    <ThemeIcon color={color} variant="light" size="sm">
      <Icon size={14} />
    </ThemeIcon>
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600}>
        {value.toLocaleString()}
      </Text>
    </Stack>
  </Group>
);

const AdminDashboard = () => {
  const { user } = useAuth();
  const client = useClient<SeedController>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const displayName = user?.name || user?.username || user?.email || "Admin";

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await client.getStatus({});
        setStats(data);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <Flex justify="center" align="center" h={400}>
        <Loader size="lg" />
      </Flex>
    );
  }

  // Calculate occupancy rate
  const occupancyRate =
    stats && stats.tripInstances > 0
      ? Math.min(
          95,
          Math.round((stats.bookings / (stats.tripInstances * 2)) * 100),
        )
      : 0;

  return (
    <Stack gap="lg" p="md">
      {/* Welcome Header */}
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" align="flex-start">
          <Group>
            <Image w={64} h={64} src="/logo-dark.png" fit="contain" />
            <Stack gap={4}>
              <Title order={2}>Welcome back, {displayName}</Title>
              <Text c="dimmed" size="sm">
                Here's what's happening with AlephaRail today
              </Text>
            </Stack>
          </Group>
          <Badge size="lg" variant="light" color="green">
            System Online
          </Badge>
        </Group>
      </Card>

      {/* Key Metrics */}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        <StatCard
          title="Total Customers"
          value={stats?.customers ?? 0}
          icon={IconUsers}
          color="green"
          subtitle="Registered accounts"
        />
        <StatCard
          title="Total Bookings"
          value={stats?.bookings ?? 0}
          icon={IconTicket}
          color="pink"
          subtitle="All time"
        />
        <StatCard
          title="Open Issues"
          value={stats?.issues ?? 0}
          icon={IconAlertCircle}
          color="orange"
          subtitle="Support tickets"
        />
        <StatCard
          title="Product Orders"
          value={stats?.productOrders ?? 0}
          icon={IconReceipt}
          color="violet"
          subtitle="Food & merchandise"
        />
      </SimpleGrid>

      {/* Secondary Stats Grid */}
      <Grid>
        {/* Operations Card */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder radius="md" p="lg" h="100%">
            <Stack gap="md">
              <Group gap="xs">
                <IconChartBar size={20} />
                <Text fw={600}>Operations Overview</Text>
              </Group>

              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                <MiniStat
                  label="Agents"
                  value={stats?.agents ?? 0}
                  icon={IconId}
                  color="orange"
                />
                <MiniStat
                  label="Devices"
                  value={stats?.devices ?? 0}
                  icon={IconDevices}
                  color="cyan"
                />
                <MiniStat
                  label="Products"
                  value={stats?.products ?? 0}
                  icon={IconPackage}
                  color="indigo"
                />
                <MiniStat
                  label="Vouchers"
                  value={stats?.vouchers ?? 0}
                  icon={IconGift}
                  color="teal"
                />
              </SimpleGrid>

              <Card withBorder p="md" radius="md">
                <SimpleGrid cols={{ base: 2, sm: 4 }}>
                  <MiniStat
                    label="Stations"
                    value={stats?.stations ?? 0}
                    icon={IconMapPin}
                    color="blue"
                  />
                  <MiniStat
                    label="Routes"
                    value={stats?.trips ?? 0}
                    icon={IconRoute}
                    color="blue"
                  />
                  <MiniStat
                    label="Trip Instances"
                    value={stats?.tripInstances ?? 0}
                    icon={IconTrain}
                    color="cyan"
                  />
                  <MiniStat
                    label="Seat Layouts"
                    value={stats?.seatLayouts ?? 0}
                    icon={IconArmchair}
                    color="cyan"
                  />
                </SimpleGrid>
              </Card>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Occupancy Card */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder radius="md" p="lg" h="100%">
            <Stack gap="md" align="center">
              <Group gap="xs">
                <IconTrendingUp size={20} />
                <Text fw={600}>Network Utilization</Text>
              </Group>

              <RingProgress
                size={160}
                thickness={16}
                roundCaps
                sections={[
                  {
                    value: occupancyRate,
                    color:
                      occupancyRate > 80
                        ? "green"
                        : occupancyRate > 50
                          ? "yellow"
                          : "red",
                  },
                ]}
                label={
                  <Stack gap={0} align="center">
                    <Text size="xl" fw={700}>
                      {occupancyRate}%
                    </Text>
                    <Text size="xs" c="dimmed">
                      Occupancy
                    </Text>
                  </Stack>
                }
              />

              <Stack gap="xs" w="100%">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Fare Classes
                  </Text>
                  <Text size="sm" fw={600}>
                    {stats?.fareClasses ?? 0}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Price Rules
                  </Text>
                  <Text size="sm" fw={600}>
                    {stats?.priceRules ?? 0}
                  </Text>
                </Group>
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Quick Actions hint */}
      <Card withBorder radius="md" p="md">
        <Group>
          <ThemeIcon color="blue" variant="light" size="lg">
            <IconTrain size={20} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text size="sm" fw={600}>
              AlephaRail Administration
            </Text>
            <Text size="xs" c="dimmed">
              Use the sidebar to navigate to Bookings, Customers, Devices, and
              more.
            </Text>
          </Stack>
        </Group>
      </Card>
    </Stack>
  );
};

export default AdminDashboard;
