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
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAccessible,
  IconArrowRight,
  IconCheck,
  IconDog,
  IconEar,
  IconEye,
  IconHeadset,
  IconPhone,
  IconWheelchair,
} from "@tabler/icons-react";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const services = [
  {
    icon: IconWheelchair,
    title: "Wheelchair Accessibility",
    description:
      "All stations have level boarding, elevators, and accessible pathways. Trains feature dedicated wheelchair spaces with tie-down points and accessible washrooms.",
    color: "blue",
  },
  {
    icon: IconEye,
    title: "Visual Impairment",
    description:
      "Tactile guidance paths, Braille signage, audio announcements, and staff assistance available. Our app supports VoiceOver and TalkBack.",
    color: "violet",
  },
  {
    icon: IconEar,
    title: "Hearing Impairment",
    description:
      "Visual displays for announcements, hearing loops at service counters, and TTY phone service. Real-time text updates via our app.",
    color: "cyan",
  },
  {
    icon: IconDog,
    title: "Service Animals",
    description:
      "Service animals are always welcome on all AlephaRail services at no charge. Please carry documentation for international travel.",
    color: "orange",
  },
];

const stationFeatures = [
  "Level boarding platforms",
  "Accessible washrooms",
  "Elevators and ramps",
  "Tactile guidance paths",
  "Hearing loops",
  "Priority seating areas",
  "Accessible parking",
  "Staff assistance",
];

const trainFeatures = [
  "Wheelchair spaces with tie-downs",
  "Accessible washrooms",
  "Priority boarding",
  "Visual and audio announcements",
  "Adjustable armrests",
  "Assistance from onboard staff",
  "Accessible dining options",
  "Emergency evacuation assistance",
];

const Accessibility = () => {
  const router = useRouter<CwsRouter>();

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-teal-9) 0%, var(--mantine-color-blue-8) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <ThemeIcon size={60} radius="xl" color="white" variant="white">
              <IconAccessible size={30} />
            </ThemeIcon>
            <Title order={1} c="white">
              Accessibility
            </Title>
            <Text size="lg" c="gray.3" maw={600}>
              AlephaRail is committed to providing accessible, barrier-free
              travel for all passengers. We strive to exceed AODA requirements
              and make rail travel accessible to everyone.
            </Text>
            <Badge variant="white" color="teal" size="lg">
              AODA Compliant
            </Badge>
          </Stack>
        </Container>
      </Box>

      {/* Services */}
      <Container size="lg" mt={-40}>
        <Grid>
          {services.map((service) => (
            <Grid.Col key={service.title} span={{ base: 12, sm: 6 }}>
              <Card withBorder radius="lg" p="xl" h="100%">
                <Stack gap="md">
                  <Group gap="md">
                    <ThemeIcon
                      size={50}
                      radius="xl"
                      color={service.color}
                      variant="light"
                    >
                      <service.icon size={24} />
                    </ThemeIcon>
                    <Title order={4}>{service.title}</Title>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {service.description}
                  </Text>
                </Stack>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      </Container>

      {/* Features */}
      <Container size="lg" py={60}>
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder radius="lg" p="xl" h="100%">
              <Stack gap="lg">
                <Group gap="md">
                  <ThemeIcon size="lg" color="blue" variant="light">
                    <IconAccessible size={20} />
                  </ThemeIcon>
                  <Title order={3}>Station Features</Title>
                </Group>
                <List
                  spacing="sm"
                  icon={
                    <ThemeIcon size="sm" color="green" variant="light">
                      <IconCheck size={12} />
                    </ThemeIcon>
                  }
                >
                  {stationFeatures.map((feature) => (
                    <List.Item key={feature}>
                      <Text size="sm">{feature}</Text>
                    </List.Item>
                  ))}
                </List>
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder radius="lg" p="xl" h="100%">
              <Stack gap="lg">
                <Group gap="md">
                  <ThemeIcon size="lg" color="orange" variant="light">
                    <IconAccessible size={20} />
                  </ThemeIcon>
                  <Title order={3}>Train Features</Title>
                </Group>
                <List
                  spacing="sm"
                  icon={
                    <ThemeIcon size="sm" color="green" variant="light">
                      <IconCheck size={12} />
                    </ThemeIcon>
                  }
                >
                  {trainFeatures.map((feature) => (
                    <List.Item key={feature}>
                      <Text size="sm">{feature}</Text>
                    </List.Item>
                  ))}
                </List>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </Container>

      {/* Booking Assistance */}
      <Box bg="var(--mantine-color-teal-light)" py={60}>
        <Container size="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="lg">
                <Badge variant="light" color="teal" w="fit-content">
                  Assistance Services
                </Badge>
                <Title order={2}>Booking Accessibility Services</Title>
                <Text c="dimmed">
                  We recommend booking accessibility services at least 48 hours
                  before your journey to ensure all arrangements are in place.
                  Our dedicated team will coordinate your needs from station
                  arrival to final destination.
                </Text>
                <Stack gap="xs">
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="teal" variant="light">
                      <IconCheck size={12} />
                    </ThemeIcon>
                    <Text size="sm">Station meet and assist</Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="teal" variant="light">
                      <IconCheck size={12} />
                    </ThemeIcon>
                    <Text size="sm">
                      Wheelchair and mobility aid assistance
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="teal" variant="light">
                      <IconCheck size={12} />
                    </ThemeIcon>
                    <Text size="sm">
                      Priority boarding and dedicated seating
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <ThemeIcon size="sm" color="teal" variant="light">
                      <IconCheck size={12} />
                    </ThemeIcon>
                    <Text size="sm">
                      Connection assistance at intermediate stations
                    </Text>
                  </Group>
                </Stack>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder radius="lg" p="xl">
                <Stack gap="lg">
                  <Title order={3}>Request Assistance</Title>
                  <Text size="sm" c="dimmed">
                    Contact our dedicated accessibility team to arrange services
                    for your journey.
                  </Text>

                  <Stack gap="md">
                    <Card withBorder p="md">
                      <Group>
                        <ThemeIcon size="lg" color="blue" variant="light">
                          <IconPhone size={20} />
                        </ThemeIcon>
                        <Stack gap={0}>
                          <Text size="sm" c="dimmed">
                            Accessibility Line
                          </Text>
                          <Text fw={600}>1-888-ALEPHA-A</Text>
                        </Stack>
                      </Group>
                    </Card>

                    <Card withBorder p="md">
                      <Group>
                        <ThemeIcon size="lg" color="green" variant="light">
                          <IconHeadset size={20} />
                        </ThemeIcon>
                        <Stack gap={0}>
                          <Text size="sm" c="dimmed">
                            TTY Service
                          </Text>
                          <Text fw={600}>1-800-268-9503</Text>
                        </Stack>
                      </Group>
                    </Card>
                  </Stack>

                  <ActionButton
                    fullWidth
                    size="lg"
                    rightSection={<IconArrowRight size={18} />}
                    onClick={() => router.go("contact")}
                  >
                    Contact Us Online
                  </ActionButton>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* Commitment */}
      <Container size="md" py={60}>
        <Card withBorder radius="lg" p="xl" ta="center">
          <Stack align="center" gap="lg">
            <ThemeIcon size={60} radius="xl" color="teal" variant="light">
              <IconAccessible size={30} />
            </ThemeIcon>
            <Title order={2}>Our Commitment</Title>
            <Text c="dimmed" maw={600}>
              AlephaRail is dedicated to continuous improvement in
              accessibility. We actively consult with disability organizations
              and incorporate feedback into our services. If you have
              suggestions or concerns, please contact our accessibility team.
            </Text>
            <Group>
              <ActionButton
                variant="light"
                onClick={() => router.go("bookingSearch")}
              >
                Book Your Trip
              </ActionButton>
              <ActionButton
                variant="subtle"
                onClick={() => router.go("helpCentre")}
              >
                View Help Centre
              </ActionButton>
            </Group>
          </Stack>
        </Card>
      </Container>

      <Footer />
    </Box>
  );
};

export default Accessibility;
