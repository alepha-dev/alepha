import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Grid,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCalendar,
  IconClock,
  IconDownload,
  IconMoon,
  IconSun,
  IconTrain,
} from "@tabler/icons-react";
import { useState } from "react";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

interface ScheduleEntry {
  train: string;
  departure: string;
  arrival: string;
  duration: string;
  service: string;
  days: string;
}

const corridorSchedules: Record<string, ScheduleEntry[]> = {
  "Toronto - Montréal": [
    {
      train: "AR 60",
      departure: "06:30",
      arrival: "11:30",
      duration: "5h 00min",
      service: "Corridor",
      days: "Daily",
    },
    {
      train: "AR 62",
      departure: "09:00",
      arrival: "14:00",
      duration: "5h 00min",
      service: "Corridor",
      days: "Daily",
    },
    {
      train: "AR 66",
      departure: "14:00",
      arrival: "19:00",
      duration: "5h 00min",
      service: "Corridor",
      days: "Daily",
    },
    {
      train: "AR 68",
      departure: "18:00",
      arrival: "23:00",
      duration: "5h 00min",
      service: "Corridor",
      days: "Daily",
    },
  ],
  "Toronto - Ottawa": [
    {
      train: "AR 40",
      departure: "07:15",
      arrival: "11:45",
      duration: "4h 30min",
      service: "Corridor",
      days: "Daily",
    },
    {
      train: "AR 44",
      departure: "12:30",
      arrival: "17:00",
      duration: "4h 30min",
      service: "Corridor",
      days: "Daily",
    },
  ],
  "Montréal - Québec City": [
    {
      train: "AR 20",
      departure: "08:00",
      arrival: "11:15",
      duration: "3h 15min",
      service: "Corridor",
      days: "Daily",
    },
    {
      train: "AR 24",
      departure: "14:00",
      arrival: "17:15",
      duration: "3h 15min",
      service: "Corridor",
      days: "Daily",
    },
  ],
  "Toronto - Windsor": [
    {
      train: "AR 70",
      departure: "07:00",
      arrival: "11:30",
      duration: "4h 30min",
      service: "Corridor",
      days: "Daily",
    },
    {
      train: "AR 72",
      departure: "17:00",
      arrival: "21:30",
      duration: "4h 30min",
      service: "Corridor",
      days: "Daily",
    },
  ],
};

const longDistanceSchedules: ScheduleEntry[] = [
  {
    train: "AR 1 - The Canadian",
    departure: "22:00 (Toronto)",
    arrival: "08:00 (Vancouver)",
    duration: "4 days",
    service: "Canadian",
    days: "Tue, Thu, Sat",
  },
  {
    train: "AR 2 - The Canadian",
    departure: "20:00 (Vancouver)",
    arrival: "06:00 (Toronto)",
    duration: "4 days",
    service: "Canadian",
    days: "Wed, Fri, Sun",
  },
  {
    train: "AR 14 - The Ocean",
    departure: "18:30 (Montréal)",
    arrival: "17:00 (Halifax)",
    duration: "22h 30min",
    service: "Ocean",
    days: "Wed, Fri, Sun",
  },
  {
    train: "AR 15 - The Ocean",
    departure: "12:30 (Halifax)",
    arrival: "11:00 (Montréal)",
    duration: "22h 30min",
    service: "Ocean",
    days: "Tue, Thu, Sat",
  },
];

const Schedules = () => {
  const router = useRouter<CwsRouter>();
  const [selectedRoute, setSelectedRoute] =
    useState<string>("Toronto - Montréal");
  const [activeTab, setActiveTab] = useState<string | null>("corridor");

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-violet-9) 0%, var(--mantine-color-dark-8) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <Badge variant="light" color="violet" size="lg">
              Train Timetables
            </Badge>
            <Title order={1} c="white">
              Schedules
            </Title>
            <Text size="lg" c="gray.4" maw={600}>
              Plan your journey with our comprehensive train schedules. From
              daily corridor services to iconic transcontinental routes.
            </Text>
          </Stack>
        </Container>
      </Box>

      {/* Quick Stats */}
      <Container size="lg" mt={-40}>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Card withBorder radius="lg" p="lg" ta="center">
            <Stack gap={4}>
              <ThemeIcon size="lg" variant="light" color="blue" mx="auto">
                <IconSun size={20} />
              </ThemeIcon>
              <Text fw={700}>First Train</Text>
              <Text size="sm" c="dimmed">
                06:30 AM
              </Text>
            </Stack>
          </Card>
          <Card withBorder radius="lg" p="lg" ta="center">
            <Stack gap={4}>
              <ThemeIcon size="lg" variant="light" color="violet" mx="auto">
                <IconMoon size={20} />
              </ThemeIcon>
              <Text fw={700}>Last Train</Text>
              <Text size="sm" c="dimmed">
                22:00 PM
              </Text>
            </Stack>
          </Card>
          <Card withBorder radius="lg" p="lg" ta="center">
            <Stack gap={4}>
              <ThemeIcon size="lg" variant="light" color="green" mx="auto">
                <IconTrain size={20} />
              </ThemeIcon>
              <Text fw={700}>Daily Services</Text>
              <Text size="sm" c="dimmed">
                500+
              </Text>
            </Stack>
          </Card>
          <Card withBorder radius="lg" p="lg" ta="center">
            <Stack gap={4}>
              <ThemeIcon size="lg" variant="light" color="orange" mx="auto">
                <IconCalendar size={20} />
              </ThemeIcon>
              <Text fw={700}>365 Days</Text>
              <Text size="sm" c="dimmed">
                Year-round service
              </Text>
            </Stack>
          </Card>
        </SimpleGrid>
      </Container>

      {/* Schedules */}
      <Container size="lg" py={60}>
        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List grow mb="xl">
            <Tabs.Tab value="corridor">Corridor Services</Tabs.Tab>
            <Tabs.Tab value="longdistance">Long Distance</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="corridor">
            <Stack gap="lg">
              <Group justify="space-between">
                <Select
                  label="Select Route"
                  value={selectedRoute}
                  onChange={(v) => v && setSelectedRoute(v)}
                  data={Object.keys(corridorSchedules)}
                  w={300}
                />
                <ActionButton
                  variant="light"
                  leftSection={<IconDownload size={16} />}
                >
                  Download PDF
                </ActionButton>
              </Group>

              <Card withBorder radius="lg" p={0}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Train</Table.Th>
                      <Table.Th>Departure</Table.Th>
                      <Table.Th>Arrival</Table.Th>
                      <Table.Th>Duration</Table.Th>
                      <Table.Th>Service</Table.Th>
                      <Table.Th>Days</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {corridorSchedules[selectedRoute]?.map((schedule) => (
                      <Table.Tr key={schedule.train}>
                        <Table.Td fw={600}>{schedule.train}</Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            <IconClock
                              size={14}
                              color="var(--mantine-color-dimmed)"
                            />
                            {schedule.departure}
                          </Group>
                        </Table.Td>
                        <Table.Td>{schedule.arrival}</Table.Td>
                        <Table.Td>
                          <Badge variant="light" color="gray">
                            {schedule.duration}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color="blue">
                            {schedule.service}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{schedule.days}</Table.Td>
                        <Table.Td>
                          <ActionButton
                            size="xs"
                            variant="subtle"
                            onClick={() => router.go("bookingSearch")}
                          >
                            Book
                          </ActionButton>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>

              <Text size="sm" c="dimmed">
                * Schedules are subject to change. Please verify times when
                booking. Business class available on all Corridor services.
              </Text>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="longdistance">
            <Stack gap="lg">
              <Card withBorder radius="lg" p={0}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Train</Table.Th>
                      <Table.Th>Departure</Table.Th>
                      <Table.Th>Arrival</Table.Th>
                      <Table.Th>Duration</Table.Th>
                      <Table.Th>Service</Table.Th>
                      <Table.Th>Days</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {longDistanceSchedules.map((schedule) => (
                      <Table.Tr key={schedule.train}>
                        <Table.Td fw={600}>{schedule.train}</Table.Td>
                        <Table.Td>{schedule.departure}</Table.Td>
                        <Table.Td>{schedule.arrival}</Table.Td>
                        <Table.Td>
                          <Badge variant="light" color="gray">
                            {schedule.duration}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            variant="light"
                            color={
                              schedule.service === "Canadian"
                                ? "orange"
                                : "cyan"
                            }
                          >
                            {schedule.service}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{schedule.days}</Table.Td>
                        <Table.Td>
                          <ActionButton
                            size="xs"
                            variant="subtle"
                            onClick={() => router.go("bookingSearch")}
                          >
                            Book
                          </ActionButton>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>

              <Card withBorder radius="lg" p="lg">
                <Stack gap="md">
                  <Title order={4}>About Long Distance Services</Title>
                  <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Stack gap="xs">
                        <Group gap="xs">
                          <Badge color="orange">The Canadian</Badge>
                        </Group>
                        <Text size="sm" c="dimmed">
                          Our flagship transcontinental service traverses
                          Canada's stunning landscape from Toronto to Vancouver,
                          passing through the Canadian Shield, prairies, and the
                          magnificent Rocky Mountains. Sleeper cabins, dome car
                          views, and gourmet dining included.
                        </Text>
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Stack gap="xs">
                        <Group gap="xs">
                          <Badge color="cyan">The Ocean</Badge>
                        </Group>
                        <Text size="sm" c="dimmed">
                          Canada's oldest named train connects Montréal with
                          Halifax, traveling through the scenic landscapes of
                          Quebec and the Maritime provinces. Overnight sleeper
                          service with views of the St. Lawrence and Atlantic
                          coast.
                        </Text>
                      </Stack>
                    </Grid.Col>
                  </Grid>
                </Stack>
              </Card>

              <Text size="sm" c="dimmed">
                * Long distance services operate year-round. Holiday and peak
                season schedules may vary. Sleeper Plus and Prestige class
                require advance booking.
              </Text>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Container>

      {/* Tips */}
      <Box bg="var(--mantine-color-violet-light)" py={60}>
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="md">
                <Title order={2}>Travel Tips</Title>
                <Stack gap="xs">
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="violet" variant="light">
                      <IconClock size={12} />
                    </ThemeIcon>
                    <Text size="sm">
                      Arrive at least 30 minutes before departure
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="violet" variant="light">
                      <IconCalendar size={12} />
                    </ThemeIcon>
                    <Text size="sm">
                      Book early for best fares on popular routes
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="violet" variant="light">
                      <IconTrain size={12} />
                    </ThemeIcon>
                    <Text size="sm">
                      Business class includes meals and lounge access
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="violet" variant="light">
                      <IconDownload size={12} />
                    </ThemeIcon>
                    <Text size="sm">
                      Download the AlephaRail app for real-time updates
                    </Text>
                  </Group>
                </Stack>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder radius="lg" p="xl" ta="center">
                <Stack align="center" gap="md">
                  <Title order={3}>Need Help Planning?</Title>
                  <Text size="sm" c="dimmed">
                    Our journey planners can help you find the best routes and
                    connections.
                  </Text>
                  <ActionButton
                    rightSection={<IconArrowRight size={16} />}
                    onClick={() => router.go("bookingSearch")}
                  >
                    Start Planning
                  </ActionButton>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      <Footer />
    </Box>
  );
};

export default Schedules;
