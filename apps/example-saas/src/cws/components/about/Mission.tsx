import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBuildingBridge,
  IconFlag,
  IconHeart,
  IconLeaf,
  IconRocket,
  IconTrain,
} from "@tabler/icons-react";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const values = [
  {
    icon: IconHeart,
    title: "Passenger First",
    description:
      "Every decision we make puts our passengers at the center. Their comfort, safety, and satisfaction drive everything we do.",
    color: "red",
  },
  {
    icon: IconLeaf,
    title: "Sustainability",
    description:
      "We're committed to carbon-neutral operations and building a greener future for Canadian transportation.",
    color: "green",
  },
  {
    icon: IconBuildingBridge,
    title: "Connecting Canada",
    description:
      "We believe in uniting communities across this vast nation, making travel accessible to all Canadians.",
    color: "blue",
  },
  {
    icon: IconRocket,
    title: "Innovation",
    description:
      "Continuous improvement in service, technology, and experience keeps us at the forefront of rail travel.",
    color: "violet",
  },
];

const milestones = [
  {
    year: "2020",
    title: "AlephaRail Founded",
    description:
      "Government of Canada establishes AlephaRail as a new Crown corporation to revitalize passenger rail.",
  },
  {
    year: "2021",
    title: "Fleet Modernization",
    description:
      "Introduction of new Siemens Charger locomotives and Venture coaches on Corridor services.",
  },
  {
    year: "2022",
    title: "Carbon Neutral",
    description:
      "Achieved carbon-neutral certification through renewable energy and offset programs.",
  },
  {
    year: "2023",
    title: "High-Frequency Rail",
    description:
      "Launched enhanced frequency on Toronto-Ottawa-Montreal corridor with dedicated tracks.",
  },
  {
    year: "2024",
    title: "Digital Transformation",
    description:
      "New booking platform, mobile app, and real-time passenger information systems deployed.",
  },
  {
    year: "2025",
    title: "Network Expansion",
    description:
      "New stations and routes announced, bringing rail to more Canadian communities.",
  },
];

const Mission = () => {
  const router = useRouter<CwsRouter>();

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-blue-9) 0%, var(--mantine-color-dark-9) 100%)"
        py={100}
      >
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Stack gap="lg">
                <Badge variant="light" color="blue" size="lg">
                  About AlephaRail
                </Badge>
                <Title order={1} c="white" size="3rem">
                  Connecting Canada,
                  <br />
                  Sustainably
                </Title>
                <Text size="lg" c="gray.4" maw={500}>
                  AlephaRail is Canada's national passenger rail service,
                  operated as a Crown corporation of the Government of Canada.
                  We're dedicated to providing safe, comfortable, and
                  environmentally responsible transportation across our nation.
                </Text>
                <Group>
                  <ActionButton
                    size="lg"
                    rightSection={<IconArrowRight size={18} />}
                    onClick={() => router.go("bookingSearch")}
                  >
                    Book Your Journey
                  </ActionButton>
                  <ActionButton
                    variant="light"
                    size="lg"
                    onClick={() => router.go("careers")}
                  >
                    Join Our Team
                  </ActionButton>
                </Group>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Card
                withBorder
                radius="lg"
                p="xl"
                bg="rgba(255,255,255,0.1)"
                style={{ borderColor: "rgba(255,255,255,0.2)" }}
              >
                <Stack align="center" ta="center" gap="md">
                  <ThemeIcon size={80} radius="xl" color="blue">
                    <IconTrain size={40} />
                  </ThemeIcon>
                  <Title order={2} c="white">
                    Our Mission
                  </Title>
                  <Text c="gray.3" size="lg">
                    To connect Canadian communities with safe, sustainable, and
                    accessible rail travel that enhances quality of life and
                    supports economic growth.
                  </Text>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* Stats */}
      <Container size="lg" mt={-40}>
        <Card withBorder radius="lg" p="xl">
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Stack align="center" gap={4}>
              <Text size="2.5rem" fw={700} c="blue">
                72M+
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                Passengers Annually
              </Text>
            </Stack>
            <Stack align="center" gap={4}>
              <Text size="2.5rem" fw={700} c="blue">
                13
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                Major Stations
              </Text>
            </Stack>
            <Stack align="center" gap={4}>
              <Text size="2.5rem" fw={700} c="blue">
                6,000+
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                km of Track
              </Text>
            </Stack>
            <Stack align="center" gap={4}>
              <Text size="2.5rem" fw={700} c="blue">
                5,000+
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                Employees
              </Text>
            </Stack>
          </SimpleGrid>
        </Card>
      </Container>

      {/* Values */}
      <Container size="lg" py={80}>
        <Stack gap="xl">
          <Stack gap="xs" align="center" ta="center">
            <Badge variant="light" color="blue">
              Our Values
            </Badge>
            <Title order={2}>What Drives Us</Title>
            <Text c="dimmed" maw={600}>
              Our values guide every decision, from the boardroom to the train
              platform.
            </Text>
          </Stack>

          <Grid>
            {values.map((value) => (
              <Grid.Col key={value.title} span={{ base: 12, sm: 6 }}>
                <Card withBorder radius="lg" p="xl" h="100%">
                  <Stack gap="md">
                    <ThemeIcon
                      size={50}
                      radius="xl"
                      color={value.color}
                      variant="light"
                    >
                      <value.icon size={24} />
                    </ThemeIcon>
                    <Title order={4}>{value.title}</Title>
                    <Text size="sm" c="dimmed">
                      {value.description}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
        </Stack>
      </Container>

      {/* Vision */}
      <Box bg="var(--mantine-color-blue-light)" py={80}>
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="lg">
                <Badge variant="light" color="blue" w="fit-content">
                  Our Vision
                </Badge>
                <Title order={2}>A Connected Canada</Title>
                <Text c="dimmed">
                  We envision a Canada where rail travel is the preferred choice
                  for intercity journeys. Where sustainable transportation
                  reduces our environmental footprint while bringing communities
                  closer together.
                </Text>
                <Text c="dimmed">
                  By 2030, we aim to double our passenger numbers, reduce
                  journey times on key corridors by 25%, and achieve net-zero
                  emissions across all operations.
                </Text>
                <Group>
                  <ThemeIcon size="lg" variant="light" color="green">
                    <IconLeaf size={20} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Text fw={600}>Carbon Neutral Since 2022</Text>
                    <Text size="sm" c="dimmed">
                      100% renewable energy on Corridor services
                    </Text>
                  </Stack>
                </Group>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder radius="lg" p="xl">
                <Stack gap="lg">
                  <Title order={3}>Our Journey</Title>
                  <Timeline active={milestones.length - 1} bulletSize={24}>
                    {milestones.map((milestone, index) => (
                      <Timeline.Item
                        key={milestone.year}
                        title={
                          <Group gap="xs">
                            <Badge variant="light" color="blue">
                              {milestone.year}
                            </Badge>
                            <Text fw={600}>{milestone.title}</Text>
                          </Group>
                        }
                      >
                        <Text size="sm" c="dimmed">
                          {milestone.description}
                        </Text>
                      </Timeline.Item>
                    ))}
                  </Timeline>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* Leadership */}
      <Container size="lg" py={80}>
        <Stack gap="xl">
          <Stack gap="xs" align="center" ta="center">
            <Badge variant="light" color="blue">
              Leadership
            </Badge>
            <Title order={2}>Guided by Experience</Title>
            <Text c="dimmed" maw={600}>
              Our leadership team brings decades of experience in
              transportation, public service, and sustainable business
              practices.
            </Text>
          </Stack>

          <Card withBorder radius="lg" p="xl" ta="center">
            <Stack align="center" gap="md">
              <IconFlag size={48} color="var(--mantine-color-blue-6)" />
              <Title order={3}>A Crown Corporation</Title>
              <Text c="dimmed" maw={700}>
                As a Crown corporation, AlephaRail operates with a mandate to
                serve the public interest. We're accountable to Parliament
                through the Minister of Transport and governed by a Board of
                Directors appointed by the Government of Canada.
              </Text>
              <Group>
                <Badge variant="light" color="red">
                  Government of Canada
                </Badge>
                <Badge variant="light" color="blue">
                  Transport Canada
                </Badge>
              </Group>
            </Stack>
          </Card>
        </Stack>
      </Container>

      {/* CTA */}
      <Box bg="dark.9" py={60}>
        <Container size="md">
          <Stack align="center" ta="center" gap="lg">
            <Title order={2} c="white">
              Experience Canadian Rail Travel
            </Title>
            <Text c="gray.4" maw={500}>
              From the Corridor to the Rockies, discover why millions of
              Canadians choose AlephaRail every year.
            </Text>
            <ActionButton
              size="lg"
              rightSection={<IconArrowRight size={18} />}
              onClick={() => router.go("bookingSearch")}
            >
              Book Your Trip Today
            </ActionButton>
          </Stack>
        </Container>
      </Box>

      <Footer />
    </Box>
  );
};

export default Mission;
