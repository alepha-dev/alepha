import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Flex,
  Grid,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconClock,
  IconMountain,
  IconTrain,
  IconWaveSine,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

interface RouteInfo {
  name: string;
  service: string;
  color: string;
  stations: string[];
  duration: string;
  frequency: string;
  description: string;
  highlights: string[];
}

const routes: RouteInfo[] = [
  {
    name: "Quebec-Windsor Corridor",
    service: "AR Corridor",
    color: "blue",
    stations: [
      "Québec City",
      "Montréal",
      "Ottawa",
      "Kingston",
      "Toronto",
      "London",
      "Windsor",
    ],
    duration: "Up to 12h",
    frequency: "Multiple daily",
    description:
      "Canada's busiest rail corridor connecting major cities in Quebec and Ontario.",
    highlights: [
      "Business class available",
      "WiFi & power outlets",
      "Bistro car service",
    ],
  },
  {
    name: "The Canadian",
    service: "AR Canadian",
    color: "orange",
    stations: ["Toronto", "Winnipeg", "Edmonton", "Jasper", "Vancouver"],
    duration: "4 days",
    frequency: "3x weekly",
    description:
      "The legendary transcontinental journey through the Canadian Rockies.",
    highlights: ["Sleeper cabins", "Dome car panoramic views", "Fine dining"],
  },
  {
    name: "The Ocean",
    service: "AR Ocean",
    color: "cyan",
    stations: ["Montréal", "Moncton", "Halifax"],
    duration: "22h 30min",
    frequency: "3x weekly",
    description:
      "Overnight service connecting Quebec with the Maritime provinces.",
    highlights: ["Sleeper service", "Ocean views", "Maritime hospitality"],
  },
];

const MetroMapLine = ({
  route,
  index,
}: {
  route: RouteInfo;
  index: number;
}) => {
  const router = useRouter<CwsRouter>();

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card withBorder radius="lg" p="xl">
        <Stack gap="lg">
          {/* Header */}
          <Group justify="space-between" wrap="nowrap">
            <Group gap="md">
              <ThemeIcon size={48} radius="md" color={route.color}>
                <IconTrain size={24} />
              </ThemeIcon>
              <Stack gap={2}>
                <Title order={3}>{route.name}</Title>
                <Group gap="xs">
                  <Badge variant="light" color={route.color}>
                    {route.service}
                  </Badge>
                  <Badge variant="outline" color="gray">
                    {route.frequency}
                  </Badge>
                </Group>
              </Stack>
            </Group>
            <Group gap={4}>
              <IconClock size={16} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed">
                {route.duration}
              </Text>
            </Group>
          </Group>

          {/* Metro Map Style Visualization */}
          <Box py="md">
            <Flex align="center" gap={0} style={{ overflowX: "auto" }}>
              {route.stations.map((station, i) => (
                <Flex key={station} align="center">
                  {/* Station dot */}
                  <Stack align="center" gap={4} miw={80}>
                    <Box
                      w={i === 0 || i === route.stations.length - 1 ? 20 : 14}
                      h={i === 0 || i === route.stations.length - 1 ? 20 : 14}
                      bg={`var(--mantine-color-${route.color}-6)`}
                      style={{
                        borderRadius: "50%",
                        border: "3px solid white",
                        boxShadow:
                          "0 0 0 2px var(--mantine-color-" +
                          route.color +
                          "-6)",
                      }}
                    />
                    <Text
                      size="xs"
                      fw={
                        i === 0 || i === route.stations.length - 1 ? 600 : 400
                      }
                      ta="center"
                    >
                      {station}
                    </Text>
                  </Stack>
                  {/* Line segment */}
                  {i < route.stations.length - 1 && (
                    <Box
                      h={4}
                      w={40}
                      bg={`var(--mantine-color-${route.color}-6)`}
                      style={{ borderRadius: 2 }}
                    />
                  )}
                </Flex>
              ))}
            </Flex>
          </Box>

          <Divider />

          {/* Description */}
          <Text size="sm" c="dimmed">
            {route.description}
          </Text>

          {/* Highlights */}
          <Group gap="xs">
            {route.highlights.map((highlight) => (
              <Badge key={highlight} variant="light" color="gray">
                {highlight}
              </Badge>
            ))}
          </Group>

          <ActionButton
            variant="light"
            color={route.color}
            rightSection={<IconArrowRight size={16} />}
            onClick={() => router.go("bookingSearch")}
          >
            View Schedule & Book
          </ActionButton>
        </Stack>
      </Card>
    </motion.div>
  );
};

const Routes = () => {
  const router = useRouter<CwsRouter>();

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-dark-8) 0%, var(--mantine-color-blue-9) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <Badge variant="light" color="blue" size="lg">
              AlephaRail Network
            </Badge>
            <Title order={1} c="white">
              Our Routes
            </Title>
            <Text size="lg" c="gray.4" maw={600}>
              Explore Canada by rail on three iconic services connecting coast
              to coast. From quick corridor trips to legendary transcontinental
              journeys.
            </Text>
          </Stack>
        </Container>
      </Box>

      {/* Route Highlights */}
      <Container size="lg" mt={-40}>
        <Grid>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder radius="lg" p="lg" h="100%">
              <Stack align="center" ta="center" gap="md">
                <ThemeIcon size={60} radius="xl" color="blue" variant="light">
                  <IconTrain size={30} />
                </ThemeIcon>
                <Title order={4}>Corridor Service</Title>
                <Text size="sm" c="dimmed">
                  High-frequency service along Canada's busiest rail route from
                  Quebec City to Windsor.
                </Text>
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder radius="lg" p="lg" h="100%">
              <Stack align="center" ta="center" gap="md">
                <ThemeIcon size={60} radius="xl" color="orange" variant="light">
                  <IconMountain size={30} />
                </ThemeIcon>
                <Title order={4}>Rocky Mountain Route</Title>
                <Text size="sm" c="dimmed">
                  The iconic transcontinental journey through Jasper National
                  Park and the Canadian Rockies.
                </Text>
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder radius="lg" p="lg" h="100%">
              <Stack align="center" ta="center" gap="md">
                <ThemeIcon size={60} radius="xl" color="cyan" variant="light">
                  <IconWaveSine size={30} />
                </ThemeIcon>
                <Title order={4}>Maritime Service</Title>
                <Text size="sm" c="dimmed">
                  Overnight service to Atlantic Canada, featuring the world's
                  highest tides and maritime charm.
                </Text>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </Container>

      {/* Route Maps */}
      <Container size="lg" py={60}>
        <Stack gap="xl">
          <Stack gap="xs" align="center" ta="center">
            <Title order={2}>Route Network Map</Title>
            <Text c="dimmed" maw={500}>
              Our three services connect 13 stations across 5 provinces,
              offering both quick day trips and multi-day adventures.
            </Text>
          </Stack>

          <Stack gap="lg">
            {routes.map((route, index) => (
              <MetroMapLine key={route.name} route={route} index={index} />
            ))}
          </Stack>
        </Stack>
      </Container>

      {/* Network Stats */}
      <Box bg="var(--mantine-color-blue-light)" py={60}>
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="md">
                <Title order={2}>Canada's Rail Network</Title>
                <Text c="dimmed">
                  AlephaRail operates one of the most extensive passenger rail
                  networks in North America, connecting major cities and scenic
                  destinations across the country.
                </Text>
                <Stack gap="xs">
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="green" variant="light">
                      <IconArrowRight size={12} />
                    </ThemeIcon>
                    <Text size="sm">Carbon-neutral operations</Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="green" variant="light">
                      <IconArrowRight size={12} />
                    </ThemeIcon>
                    <Text size="sm">Accessible stations and trains</Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="green" variant="light">
                      <IconArrowRight size={12} />
                    </ThemeIcon>
                    <Text size="sm">Free WiFi on all services</Text>
                  </Group>
                </Stack>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Grid>
                <Grid.Col span={6}>
                  <Card withBorder p="lg" ta="center">
                    <Text size="2rem" fw={700} c="blue">
                      6,000+
                    </Text>
                    <Text size="sm" c="dimmed">
                      km of Track
                    </Text>
                  </Card>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Card withBorder p="lg" ta="center">
                    <Text size="2rem" fw={700} c="blue">
                      500+
                    </Text>
                    <Text size="sm" c="dimmed">
                      Daily Departures
                    </Text>
                  </Card>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Card withBorder p="lg" ta="center">
                    <Text size="2rem" fw={700} c="blue">
                      13
                    </Text>
                    <Text size="sm" c="dimmed">
                      Major Stations
                    </Text>
                  </Card>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Card withBorder p="lg" ta="center">
                    <Text size="2rem" fw={700} c="blue">
                      5
                    </Text>
                    <Text size="sm" c="dimmed">
                      Provinces Served
                    </Text>
                  </Card>
                </Grid.Col>
              </Grid>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* CTA */}
      <Container size="md" py={60}>
        <Card withBorder radius="lg" p="xl" ta="center">
          <Stack align="center" gap="lg">
            <Title order={2}>Plan Your Journey</Title>
            <Text c="dimmed" maw={500}>
              Whether it's a business trip to Ottawa or a scenic adventure
              through the Rockies, we'll get you there comfortably.
            </Text>
            <ActionButton
              size="lg"
              rightSection={<IconArrowRight size={18} />}
              onClick={() => router.go("bookingSearch")}
            >
              Search Trains
            </ActionButton>
          </Stack>
        </Card>
      </Container>

      <Footer />
    </Box>
  );
};

export default Routes;
