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
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBriefcase,
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconClock,
  IconCode,
  IconCoin,
  IconHeart,
  IconMapPin,
  IconSchool,
  IconTools,
  IconTrain,
  IconUsers,
} from "@tabler/icons-react";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const benefits = [
  {
    icon: IconCoin,
    title: "Competitive Compensation",
    description:
      "Salary packages aligned with public sector pay scales plus performance bonuses.",
  },
  {
    icon: IconHeart,
    title: "Health & Wellness",
    description:
      "Comprehensive benefits including dental, vision, mental health support, and fitness subsidies.",
  },
  {
    icon: IconCalendar,
    title: "Work-Life Balance",
    description:
      "Flexible schedules, generous vacation time, and family-friendly policies.",
  },
  {
    icon: IconTrain,
    title: "Travel Benefits",
    description:
      "Free rail travel for you and your family across the entire AlephaRail network.",
  },
  {
    icon: IconSchool,
    title: "Learning & Development",
    description:
      "Tuition assistance, professional certifications, and internal training programs.",
  },
  {
    icon: IconUsers,
    title: "Pension Plan",
    description:
      "Defined benefit pension plan as part of the federal public service.",
  },
];

const departments = [
  {
    icon: IconTrain,
    title: "Operations",
    description: "Train crews, station staff, and customer service",
    openings: 45,
    color: "blue",
  },
  {
    icon: IconTools,
    title: "Engineering",
    description: "Infrastructure, rolling stock, and maintenance",
    openings: 28,
    color: "orange",
  },
  {
    icon: IconCode,
    title: "Technology",
    description: "Software development, IT, and digital innovation",
    openings: 22,
    color: "violet",
  },
  {
    icon: IconBuilding,
    title: "Corporate",
    description: "Finance, HR, legal, and communications",
    openings: 15,
    color: "green",
  },
];

const featuredJobs = [
  {
    title: "Train Conductor",
    location: "Toronto, ON",
    type: "Full-time",
    department: "Operations",
  },
  {
    title: "Senior Software Engineer",
    location: "Montréal, QC",
    type: "Full-time",
    department: "Technology",
  },
  {
    title: "Station Customer Service Agent",
    location: "Vancouver, BC",
    type: "Full-time",
    department: "Operations",
  },
  {
    title: "Infrastructure Engineer",
    location: "Ottawa, ON",
    type: "Full-time",
    department: "Engineering",
  },
  {
    title: "Data Analyst",
    location: "Remote",
    type: "Full-time",
    department: "Technology",
  },
  {
    title: "Mechanical Technician",
    location: "Winnipeg, MB",
    type: "Full-time",
    department: "Engineering",
  },
];

const Careers = () => {
  const router = useRouter<CwsRouter>();

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-violet-9) 0%, var(--mantine-color-indigo-8) 100%)"
        py={100}
      >
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Stack gap="lg">
                <Badge variant="light" color="violet" size="lg">
                  Join Our Team
                </Badge>
                <Title order={1} c="white" size="3rem">
                  Build Your Career
                  <br />
                  at AlephaRail
                </Title>
                <Text size="lg" c="gray.4" maw={500}>
                  Join over 5,000 professionals working to connect Canada. From
                  train crews to software engineers, we're looking for talented
                  people who share our passion for sustainable transportation.
                </Text>
                <Group>
                  <ActionButton
                    size="lg"
                    rightSection={<IconArrowRight size={18} />}
                  >
                    View All Openings
                  </ActionButton>
                  <ActionButton variant="light" size="lg">
                    Life at AlephaRail
                  </ActionButton>
                </Group>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Card withBorder radius="lg" p="xl">
                <Stack gap="lg">
                  <Group justify="space-between">
                    <Title order={3}>Open Positions</Title>
                    <Badge size="xl" variant="light" color="violet">
                      110+
                    </Badge>
                  </Group>
                  <SimpleGrid cols={2}>
                    {departments.map((dept) => (
                      <Card key={dept.title} withBorder p="md" radius="md">
                        <Stack gap="xs" align="center" ta="center">
                          <ThemeIcon
                            size="lg"
                            color={dept.color}
                            variant="light"
                          >
                            <dept.icon size={20} />
                          </ThemeIcon>
                          <Text size="sm" fw={600}>
                            {dept.title}
                          </Text>
                          <Badge variant="light" color={dept.color}>
                            {dept.openings} roles
                          </Badge>
                        </Stack>
                      </Card>
                    ))}
                  </SimpleGrid>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* Benefits */}
      <Container size="lg" py={80}>
        <Stack gap="xl">
          <Stack gap="xs" align="center" ta="center">
            <Badge variant="light" color="violet">
              Why AlephaRail
            </Badge>
            <Title order={2}>Benefits & Perks</Title>
            <Text c="dimmed" maw={600}>
              As a Crown corporation, we offer the stability of public service
              with the dynamism of a transportation company.
            </Text>
          </Stack>

          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {benefits.map((benefit) => (
              <Card key={benefit.title} withBorder radius="lg" p="xl">
                <Stack gap="md">
                  <ThemeIcon
                    size={50}
                    radius="xl"
                    color="violet"
                    variant="light"
                  >
                    <benefit.icon size={24} />
                  </ThemeIcon>
                  <Title order={4}>{benefit.title}</Title>
                  <Text size="sm" c="dimmed">
                    {benefit.description}
                  </Text>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </Container>

      {/* Featured Jobs */}
      <Box bg="var(--mantine-color-violet-light)" py={80}>
        <Container size="lg">
          <Stack gap="xl">
            <Group justify="space-between">
              <Stack gap="xs">
                <Title order={2}>Featured Opportunities</Title>
                <Text c="dimmed">
                  Explore current openings across our network
                </Text>
              </Stack>
              <ActionButton variant="subtle">View All Jobs</ActionButton>
            </Group>

            <Grid>
              {featuredJobs.map((job) => (
                <Grid.Col key={job.title} span={{ base: 12, sm: 6, md: 4 }}>
                  <Card
                    withBorder
                    radius="lg"
                    p="lg"
                    style={{ cursor: "pointer" }}
                  >
                    <Stack gap="md">
                      <Stack gap={4}>
                        <Title order={4}>{job.title}</Title>
                        <Badge variant="light" w="fit-content">
                          {job.department}
                        </Badge>
                      </Stack>
                      <Group gap="lg">
                        <Group gap={4}>
                          <IconMapPin
                            size={14}
                            color="var(--mantine-color-dimmed)"
                          />
                          <Text size="sm" c="dimmed">
                            {job.location}
                          </Text>
                        </Group>
                        <Group gap={4}>
                          <IconClock
                            size={14}
                            color="var(--mantine-color-dimmed)"
                          />
                          <Text size="sm" c="dimmed">
                            {job.type}
                          </Text>
                        </Group>
                      </Group>
                      <ActionButton variant="light" fullWidth size="sm">
                        View Details
                      </ActionButton>
                    </Stack>
                  </Card>
                </Grid.Col>
              ))}
            </Grid>
          </Stack>
        </Container>
      </Box>

      {/* Culture */}
      <Container size="lg" py={80}>
        <Grid align="center">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Stack gap="lg">
              <Badge variant="light" color="violet" w="fit-content">
                Our Culture
              </Badge>
              <Title order={2}>Life at AlephaRail</Title>
              <Text c="dimmed">
                We're more than a transportation company - we're a community of
                passionate professionals dedicated to connecting Canada. Our
                culture values diversity, innovation, and work-life balance.
              </Text>

              <List
                spacing="md"
                icon={
                  <ThemeIcon size="sm" color="violet" variant="light">
                    <IconCheck size={12} />
                  </ThemeIcon>
                }
              >
                <List.Item>
                  <Text size="sm">
                    <strong>Diversity & Inclusion:</strong> 45% of leadership
                    positions held by women and underrepresented groups
                  </Text>
                </List.Item>
                <List.Item>
                  <Text size="sm">
                    <strong>Indigenous Partnerships:</strong> Active
                    reconciliation programs and Indigenous hiring initiatives
                  </Text>
                </List.Item>
                <List.Item>
                  <Text size="sm">
                    <strong>Bilingual Environment:</strong> Services and
                    workplace communications in both official languages
                  </Text>
                </List.Item>
                <List.Item>
                  <Text size="sm">
                    <strong>Remote Work:</strong> Flexible arrangements for
                    eligible positions
                  </Text>
                </List.Item>
              </List>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <SimpleGrid cols={2}>
              <Card withBorder radius="lg" p="xl" ta="center">
                <Stack gap={4}>
                  <Text size="2.5rem" fw={700} c="violet">
                    5,000+
                  </Text>
                  <Text size="sm" c="dimmed">
                    Employees
                  </Text>
                </Stack>
              </Card>
              <Card withBorder radius="lg" p="xl" ta="center">
                <Stack gap={4}>
                  <Text size="2.5rem" fw={700} c="violet">
                    92%
                  </Text>
                  <Text size="sm" c="dimmed">
                    Employee Satisfaction
                  </Text>
                </Stack>
              </Card>
              <Card withBorder radius="lg" p="xl" ta="center">
                <Stack gap={4}>
                  <Text size="2.5rem" fw={700} c="violet">
                    12
                  </Text>
                  <Text size="sm" c="dimmed">
                    Office Locations
                  </Text>
                </Stack>
              </Card>
              <Card withBorder radius="lg" p="xl" ta="center">
                <Stack gap={4}>
                  <Text size="2.5rem" fw={700} c="violet">
                    8 yrs
                  </Text>
                  <Text size="sm" c="dimmed">
                    Avg. Tenure
                  </Text>
                </Stack>
              </Card>
            </SimpleGrid>
          </Grid.Col>
        </Grid>
      </Container>

      {/* CTA */}
      <Box bg="dark.9" py={60}>
        <Container size="md">
          <Stack align="center" ta="center" gap="lg">
            <ThemeIcon size={60} radius="xl" color="violet" variant="light">
              <IconBriefcase size={30} />
            </ThemeIcon>
            <Title order={2} c="white">
              Ready to Join Us?
            </Title>
            <Text c="gray.4" maw={500}>
              Explore our open positions and take the first step toward a
              rewarding career connecting Canada.
            </Text>
            <Group>
              <ActionButton
                size="lg"
                color="violet"
                rightSection={<IconArrowRight size={18} />}
              >
                Browse All Jobs
              </ActionButton>
              <ActionButton variant="light" size="lg">
                Student Programs
              </ActionButton>
            </Group>
          </Stack>
        </Container>
      </Box>

      <Footer />
    </Box>
  );
};

export default Careers;
