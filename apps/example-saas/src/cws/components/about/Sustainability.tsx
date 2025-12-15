import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Grid,
  Group,
  List,
  Progress,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconDroplet,
  IconLeaf,
  IconPlant,
  IconRecycle,
  IconSun,
  IconTree,
} from "@tabler/icons-react";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const initiatives = [
  {
    icon: IconBolt,
    title: "Electric Fleet",
    description:
      "65% of our Corridor fleet runs on electric power from renewable sources. Full electrification planned by 2030.",
    progress: 65,
    color: "yellow",
  },
  {
    icon: IconSun,
    title: "Renewable Energy",
    description:
      "All stations powered by 100% renewable energy through wind and solar partnerships.",
    progress: 100,
    color: "orange",
  },
  {
    icon: IconRecycle,
    title: "Zero Waste",
    description:
      "85% of onboard waste is recycled or composted. Working toward zero waste by 2027.",
    progress: 85,
    color: "green",
  },
  {
    icon: IconDroplet,
    title: "Water Conservation",
    description:
      "40% reduction in water usage through efficient systems and rainwater collection.",
    progress: 40,
    color: "cyan",
  },
];

const comparisons = [
  { mode: "Train", co2: 41, color: "green" },
  { mode: "Bus", co2: 89, color: "blue" },
  { mode: "Car (1 person)", co2: 192, color: "orange" },
  { mode: "Plane", co2: 255, color: "red" },
];

const achievements = [
  {
    year: "2022",
    title: "Carbon Neutral Certification",
    description:
      "Achieved carbon neutral status through emissions reduction and verified offset programs.",
  },
  {
    year: "2023",
    title: "Green Station Award",
    description:
      "Toronto Union Station certified LEED Platinum for sustainable building operations.",
  },
  {
    year: "2024",
    title: "Clean50 Recognition",
    description:
      "Named to Canada's Clean50 list for leadership in sustainable transportation.",
  },
];

const Sustainability = () => {
  const router = useRouter<CwsRouter>();

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-green-9) 0%, var(--mantine-color-teal-8) 100%)"
        py={100}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <Badge variant="white" color="green" size="lg">
              Environmental Commitment
            </Badge>
            <Title order={1} c="white" size="3rem">
              Building a Greener
              <br />
              Canada
            </Title>
            <Text size="lg" c="gray.3" maw={600}>
              Rail is inherently one of the most sustainable forms of
              transportation. At AlephaRail, we're pushing further with our
              commitment to net-zero emissions and environmental stewardship.
            </Text>
            <Group>
              <Badge variant="white" color="green" size="xl">
                Carbon Neutral Since 2022
              </Badge>
            </Group>
          </Stack>
        </Container>
      </Box>

      {/* Carbon Comparison */}
      <Container size="lg" mt={-40}>
        <Card withBorder radius="lg" p="xl">
          <Stack gap="lg">
            <Group justify="space-between">
              <Stack gap={0}>
                <Title order={3}>CO2 Emissions Comparison</Title>
                <Text size="sm" c="dimmed">
                  Grams of CO2 per passenger-kilometer
                </Text>
              </Stack>
              <Badge variant="light" color="green">
                Train is 5x cleaner than flying
              </Badge>
            </Group>

            <Stack gap="md">
              {comparisons.map((item) => (
                <Stack key={item.mode} gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" fw={item.mode === "Train" ? 600 : 400}>
                      {item.mode}
                    </Text>
                    <Text size="sm" fw={600}>
                      {item.co2}g CO2
                    </Text>
                  </Group>
                  <Progress
                    value={(item.co2 / 255) * 100}
                    color={item.color}
                    size="lg"
                    radius="xl"
                  />
                </Stack>
              ))}
            </Stack>

            <Text size="xs" c="dimmed" ta="center">
              Source: Transport Canada Environmental Report 2024
            </Text>
          </Stack>
        </Card>
      </Container>

      {/* Initiatives */}
      <Container size="lg" py={80}>
        <Stack gap="xl">
          <Stack gap="xs" align="center" ta="center">
            <Badge variant="light" color="green">
              Our Initiatives
            </Badge>
            <Title order={2}>Sustainability in Action</Title>
            <Text c="dimmed" maw={600}>
              From clean energy to waste reduction, we're taking concrete steps
              to minimize our environmental impact.
            </Text>
          </Stack>

          <Grid>
            {initiatives.map((initiative) => (
              <Grid.Col key={initiative.title} span={{ base: 12, sm: 6 }}>
                <Card withBorder radius="lg" p="xl" h="100%">
                  <Stack gap="md">
                    <Group justify="space-between">
                      <Group gap="md">
                        <ThemeIcon
                          size={50}
                          radius="xl"
                          color={initiative.color}
                          variant="light"
                        >
                          <initiative.icon size={24} />
                        </ThemeIcon>
                        <Title order={4}>{initiative.title}</Title>
                      </Group>
                      <RingProgress
                        size={60}
                        thickness={6}
                        sections={[
                          {
                            value: initiative.progress,
                            color: initiative.color,
                          },
                        ]}
                        label={
                          <Text size="xs" ta="center" fw={700}>
                            {initiative.progress}%
                          </Text>
                        }
                      />
                    </Group>
                    <Text size="sm" c="dimmed">
                      {initiative.description}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
        </Stack>
      </Container>

      {/* Net Zero Roadmap */}
      <Box bg="var(--mantine-color-green-light)" py={80}>
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="lg">
                <Badge variant="light" color="green" w="fit-content">
                  Net Zero by 2035
                </Badge>
                <Title order={2}>Our Roadmap to Net Zero</Title>
                <Text c="dimmed">
                  We've set ambitious targets aligned with Canada's net-zero
                  commitments. Our comprehensive plan addresses emissions across
                  operations, fleet, and supply chain.
                </Text>

                <List
                  spacing="md"
                  icon={
                    <ThemeIcon size="sm" color="green" variant="light">
                      <IconCheck size={12} />
                    </ThemeIcon>
                  }
                >
                  <List.Item>
                    <Text size="sm">
                      <strong>2025:</strong> 75% renewable energy across all
                      operations
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="sm">
                      <strong>2027:</strong> Zero waste to landfill
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="sm">
                      <strong>2030:</strong> Full Corridor electrification
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="sm">
                      <strong>2032:</strong> Hydrogen-powered long-distance
                      trains
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="sm">
                      <strong>2035:</strong> Net-zero emissions achieved
                    </Text>
                  </List.Item>
                </List>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder radius="lg" p="xl" ta="center">
                <Stack align="center" gap="lg">
                  <RingProgress
                    size={200}
                    thickness={20}
                    roundCaps
                    sections={[
                      { value: 42, color: "green" },
                      { value: 23, color: "teal" },
                      { value: 15, color: "cyan" },
                    ]}
                    label={
                      <Stack gap={0} align="center">
                        <Text size="2rem" fw={700}>
                          80%
                        </Text>
                        <Text size="xs" c="dimmed">
                          Progress to Net Zero
                        </Text>
                      </Stack>
                    }
                  />

                  <SimpleGrid cols={3} spacing="xs">
                    <Stack gap={0} align="center">
                      <Badge color="green" variant="light">
                        42%
                      </Badge>
                      <Text size="xs" c="dimmed">
                        Energy
                      </Text>
                    </Stack>
                    <Stack gap={0} align="center">
                      <Badge color="teal" variant="light">
                        23%
                      </Badge>
                      <Text size="xs" c="dimmed">
                        Fleet
                      </Text>
                    </Stack>
                    <Stack gap={0} align="center">
                      <Badge color="cyan" variant="light">
                        15%
                      </Badge>
                      <Text size="xs" c="dimmed">
                        Operations
                      </Text>
                    </Stack>
                  </SimpleGrid>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* Achievements */}
      <Container size="lg" py={80}>
        <Stack gap="xl">
          <Stack gap="xs" align="center" ta="center">
            <Badge variant="light" color="green">
              Recognition
            </Badge>
            <Title order={2}>Awards & Achievements</Title>
          </Stack>

          <SimpleGrid cols={{ base: 1, md: 3 }}>
            {achievements.map((achievement) => (
              <Card key={achievement.title} withBorder radius="lg" p="xl">
                <Stack gap="md">
                  <Badge variant="light" color="green" w="fit-content">
                    {achievement.year}
                  </Badge>
                  <Title order={4}>{achievement.title}</Title>
                  <Text size="sm" c="dimmed">
                    {achievement.description}
                  </Text>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </Container>

      {/* Partnership */}
      <Box bg="dark.9" py={60}>
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 8 }}>
              <Stack gap="md">
                <Group gap="md">
                  <ThemeIcon size="lg" color="green" variant="light">
                    <IconTree size={20} />
                  </ThemeIcon>
                  <Title order={3} c="white">
                    Carbon Offset Partnership
                  </Title>
                </Group>
                <Text c="gray.4">
                  For emissions we can't yet eliminate, we partner with verified
                  Canadian reforestation projects. Every trip contributes to
                  planting native trees across Canada, supporting biodiversity
                  and local communities.
                </Text>
                <Text c="gray.5" size="sm">
                  Over 2 million trees planted since 2020
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Stack align="center">
                <ThemeIcon size={80} radius="xl" color="green" variant="light">
                  <IconPlant size={40} />
                </ThemeIcon>
                <Text size="2rem" fw={700} c="white">
                  2M+
                </Text>
                <Text c="gray.4">Trees Planted</Text>
              </Stack>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* CTA */}
      <Container size="md" py={60}>
        <Card withBorder radius="lg" p="xl" ta="center">
          <Stack align="center" gap="lg">
            <ThemeIcon size={60} radius="xl" color="green" variant="light">
              <IconLeaf size={30} />
            </ThemeIcon>
            <Title order={2}>Travel Green</Title>
            <Text c="dimmed" maw={500}>
              Choose rail and reduce your carbon footprint by up to 80% compared
              to flying. Every journey makes a difference.
            </Text>
            <ActionButton
              size="lg"
              color="green"
              rightSection={<IconArrowRight size={18} />}
              onClick={() => router.go("bookingSearch")}
            >
              Book Your Green Trip
            </ActionButton>
          </Stack>
        </Card>
      </Container>

      <Footer />
    </Box>
  );
};

export default Sustainability;
