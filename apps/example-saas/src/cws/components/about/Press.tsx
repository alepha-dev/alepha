import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandX,
  IconCalendar,
  IconCamera,
  IconDownload,
  IconMail,
  IconNews,
  IconPhone,
  IconVideo,
} from "@tabler/icons-react";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const pressReleases = [
  {
    date: "December 10, 2025",
    title: "AlephaRail Announces Holiday Travel Schedule Enhancements",
    excerpt:
      "Additional trains added on popular routes to meet increased demand during the holiday season.",
    category: "Operations",
  },
  {
    date: "November 28, 2025",
    title: "AlephaRail Reaches 80 Million Passenger Milestone",
    excerpt:
      "Record ridership achieved as more Canadians choose sustainable rail travel.",
    category: "Milestone",
  },
  {
    date: "November 15, 2025",
    title: "New High-Frequency Service Launches on Ottawa-Toronto Corridor",
    excerpt:
      "Eight daily departures now available with reduced travel times using dedicated tracks.",
    category: "Service",
  },
  {
    date: "October 30, 2025",
    title: "AlephaRail Partners with Indigenous Communities on Jasper Route",
    excerpt:
      "New interpretive program celebrates Indigenous heritage along The Canadian route.",
    category: "Partnership",
  },
  {
    date: "October 12, 2025",
    title: "Fleet Modernization: New Venture Coaches Enter Service",
    excerpt:
      "State-of-the-art coaches feature improved accessibility, WiFi, and passenger comfort.",
    category: "Fleet",
  },
  {
    date: "September 25, 2025",
    title: "AlephaRail Named to Canada's Clean50 for Third Consecutive Year",
    excerpt:
      "Recognition for leadership in sustainable transportation and carbon reduction initiatives.",
    category: "Award",
  },
];

const mediaContacts = [
  {
    name: "Sarah Mitchell",
    title: "Director of Communications",
    email: "sarah.mitchell@alepharail.ca",
    phone: "(613) 555-0123",
    region: "National",
  },
  {
    name: "Jean-Pierre Lavoie",
    title: "Communications Manager",
    email: "jp.lavoie@alepharail.ca",
    phone: "(514) 555-0124",
    region: "Québec",
  },
  {
    name: "Michael Chen",
    title: "Media Relations",
    email: "michael.chen@alepharail.ca",
    phone: "(416) 555-0125",
    region: "Ontario",
  },
];

const resources = [
  {
    icon: IconCamera,
    title: "Photo Library",
    description: "High-resolution images of trains, stations, and operations",
    action: "Browse Photos",
  },
  {
    icon: IconVideo,
    title: "Video Assets",
    description: "B-roll footage and official video content",
    action: "View Videos",
  },
  {
    icon: IconDownload,
    title: "Brand Guidelines",
    description: "Logos, colors, and brand usage guidelines",
    action: "Download Kit",
  },
  {
    icon: IconNews,
    title: "Fact Sheets",
    description: "Key statistics and company information",
    action: "View Facts",
  },
];

const socialStats = [
  { icon: IconBrandX, name: "X (Twitter)", followers: "125K" },
  { icon: IconBrandFacebook, name: "Facebook", followers: "89K" },
  { icon: IconBrandInstagram, name: "Instagram", followers: "67K" },
  { icon: IconBrandLinkedin, name: "LinkedIn", followers: "45K" },
];

const Press = () => {
  const router = useRouter<CwsRouter>();

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-dark-8) 0%, var(--mantine-color-dark-9) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <Badge variant="light" color="gray" size="lg">
              Press & Media
            </Badge>
            <Title order={1} c="white" size="3rem">
              Newsroom
            </Title>
            <Text size="lg" c="gray.4" maw={600}>
              The latest news, press releases, and media resources from
              AlephaRail. For media inquiries, please contact our communications
              team.
            </Text>
            <Group>
              <ActionButton
                size="lg"
                rightSection={<IconArrowRight size={18} />}
              >
                Media Contact
              </ActionButton>
              <ActionButton variant="light" size="lg">
                Download Press Kit
              </ActionButton>
            </Group>
          </Stack>
        </Container>
      </Box>

      {/* Latest News */}
      <Container size="lg" mt={-40}>
        <Card withBorder radius="lg" p="xl">
          <Stack gap="lg">
            <Group justify="space-between">
              <Title order={3}>Latest Press Releases</Title>
              <ActionButton
                variant="subtle"
                rightSection={<IconArrowRight size={16} />}
              >
                View All
              </ActionButton>
            </Group>

            <Stack gap="md">
              {pressReleases.slice(0, 3).map((release, index) => (
                <Box key={release.title}>
                  {index > 0 && <Divider mb="md" />}
                  <Group
                    justify="space-between"
                    wrap="nowrap"
                    align="flex-start"
                  >
                    <Stack gap="xs">
                      <Group gap="xs">
                        <Badge variant="light" color="blue">
                          {release.category}
                        </Badge>
                        <Group gap={4}>
                          <IconCalendar
                            size={14}
                            color="var(--mantine-color-dimmed)"
                          />
                          <Text size="xs" c="dimmed">
                            {release.date}
                          </Text>
                        </Group>
                      </Group>
                      <Text fw={600}>{release.title}</Text>
                      <Text size="sm" c="dimmed">
                        {release.excerpt}
                      </Text>
                    </Stack>
                    <ActionButton variant="subtle" size="sm">
                      Read More
                    </ActionButton>
                  </Group>
                </Box>
              ))}
            </Stack>
          </Stack>
        </Card>
      </Container>

      {/* Press Releases Archive */}
      <Container size="lg" py={60}>
        <Stack gap="xl">
          <Title order={2}>Press Releases</Title>

          <Grid>
            {pressReleases.map((release) => (
              <Grid.Col key={release.title} span={{ base: 12, md: 6 }}>
                <Card
                  withBorder
                  radius="lg"
                  p="lg"
                  h="100%"
                  style={{ cursor: "pointer" }}
                >
                  <Stack gap="md">
                    <Group gap="xs">
                      <Badge variant="light" color="blue">
                        {release.category}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {release.date}
                      </Text>
                    </Group>
                    <Title order={4}>{release.title}</Title>
                    <Text size="sm" c="dimmed" lineClamp={2}>
                      {release.excerpt}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
        </Stack>
      </Container>

      {/* Media Resources */}
      <Box bg="var(--mantine-color-gray-light)" py={60}>
        <Container size="lg">
          <Stack gap="xl">
            <Stack gap="xs" align="center" ta="center">
              <Badge variant="light" color="gray">
                For Journalists
              </Badge>
              <Title order={2}>Media Resources</Title>
              <Text c="dimmed">
                Download official assets and resources for your coverage
              </Text>
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
              {resources.map((resource) => (
                <Card key={resource.title} withBorder radius="lg" p="xl">
                  <Stack gap="md" align="center" ta="center">
                    <ThemeIcon
                      size={50}
                      radius="xl"
                      color="dark"
                      variant="light"
                    >
                      <resource.icon size={24} />
                    </ThemeIcon>
                    <Title order={4}>{resource.title}</Title>
                    <Text size="sm" c="dimmed">
                      {resource.description}
                    </Text>
                    <ActionButton variant="light" fullWidth>
                      {resource.action}
                    </ActionButton>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        </Container>
      </Box>

      {/* Media Contacts */}
      <Container size="lg" py={60}>
        <Grid>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="lg">
              <Stack gap="xs">
                <Title order={2}>Media Contacts</Title>
                <Text c="dimmed">
                  For press inquiries, please contact our communications team
                </Text>
              </Stack>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {mediaContacts.map((contact) => (
                  <Card key={contact.name} withBorder radius="lg" p="lg">
                    <Stack gap="md">
                      <Stack gap={4}>
                        <Text fw={600}>{contact.name}</Text>
                        <Text size="sm" c="dimmed">
                          {contact.title}
                        </Text>
                        <Badge variant="light" size="sm" w="fit-content">
                          {contact.region}
                        </Badge>
                      </Stack>
                      <Stack gap="xs">
                        <Group gap="xs">
                          <IconMail
                            size={14}
                            color="var(--mantine-color-dimmed)"
                          />
                          <Text size="sm">{contact.email}</Text>
                        </Group>
                        <Group gap="xs">
                          <IconPhone
                            size={14}
                            color="var(--mantine-color-dimmed)"
                          />
                          <Text size="sm">{contact.phone}</Text>
                        </Group>
                      </Stack>
                    </Stack>
                  </Card>
                ))}
              </SimpleGrid>

              <Card withBorder radius="lg" p="lg">
                <Group justify="space-between">
                  <Stack gap={4}>
                    <Text fw={600}>General Media Inquiries</Text>
                    <Text size="sm" c="dimmed">
                      For urgent requests outside business hours
                    </Text>
                  </Stack>
                  <Stack gap={0} align="flex-end">
                    <Text fw={600}>media@alepharail.ca</Text>
                    <Text size="sm" c="dimmed">
                      1-888-ALEPHA-M
                    </Text>
                  </Stack>
                </Group>
              </Card>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="lg">
              {/* Social Media */}
              <Card withBorder radius="lg" p="xl">
                <Stack gap="lg">
                  <Title order={4}>Follow Us</Title>
                  <Stack gap="md">
                    {socialStats.map((social) => (
                      <Group key={social.name} justify="space-between">
                        <Group gap="xs">
                          <ThemeIcon size="sm" variant="light" color="gray">
                            <social.icon size={14} />
                          </ThemeIcon>
                          <Text size="sm">{social.name}</Text>
                        </Group>
                        <Badge variant="light">
                          {social.followers} followers
                        </Badge>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
              </Card>

              {/* Newsletter */}
              <Card withBorder radius="lg" p="xl">
                <Stack gap="md">
                  <Title order={4}>Press Newsletter</Title>
                  <Text size="sm" c="dimmed">
                    Subscribe to receive press releases and media alerts
                    directly to your inbox.
                  </Text>
                  <TextInput placeholder="your@email.com" />
                  <ActionButton fullWidth>Subscribe</ActionButton>
                </Stack>
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>
      </Container>

      {/* Company Facts */}
      <Box bg="dark.9" py={60}>
        <Container size="lg">
          <Stack gap="xl">
            <Stack gap="xs" align="center" ta="center">
              <Title order={2} c="white">
                Quick Facts
              </Title>
              <Text c="gray.4">Key statistics about AlephaRail</Text>
            </Stack>

            <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }}>
              {[
                { label: "Founded", value: "2020" },
                { label: "Employees", value: "5,000+" },
                { label: "Stations", value: "13" },
                { label: "Annual Passengers", value: "72M" },
                { label: "Track km", value: "6,000+" },
                { label: "Carbon Status", value: "Neutral" },
              ].map((fact) => (
                <Card key={fact.label} p="md" bg="dark.8" ta="center">
                  <Stack gap={0}>
                    <Text size="xl" fw={700} c="white">
                      {fact.value}
                    </Text>
                    <Text size="xs" c="gray.5">
                      {fact.label}
                    </Text>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        </Container>
      </Box>

      <Footer />
    </Box>
  );
};

export default Press;
