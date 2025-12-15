import { useAction, useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Alert,
  Badge,
  Box,
  Card,
  Container,
  Grid,
  Group,
  List,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Timeline,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowRight,
  IconCheck,
  IconLuggage,
  IconMail,
  IconMapPin,
  IconPhone,
  IconSearch,
} from "@tabler/icons-react";
import { $client } from "alepha/server/links";
import { useState } from "react";
import type { IssueController } from "../../../api/issues/controllers/IssueController.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const commonItems = [
  "Electronics (phones, laptops, tablets)",
  "Bags and luggage",
  "Clothing and accessories",
  "Books and documents",
  "Keys and wallets",
  "Umbrellas",
];

const Stations = [
  "Toronto Union Station",
  "Montr&eacute;al Central Station",
  "Ottawa Station",
  "Vancouver Pacific Central",
  "Winnipeg Union Station",
  "Qu&eacute;bec City Station",
  "Halifax Station",
  "Kingston Station",
  "London Station",
  "Windsor Station",
  "Edmonton Station",
  "Jasper Station",
  "Moncton Station",
];

const LostAndFound = () => {
  const router = useRouter<CwsRouter>();
  const issueController = $client<IssueController>();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState<string | null>(null);
  const [travelDate, setTravelDate] = useState("");
  const [itemCategory, setItemCategory] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitAction = useAction(
    {
      handler: async () => {
        await issueController.createIssue({
          body: {
            title: `Lost Item: ${itemCategory || "Item"} - ${location || "Unknown location"}`,
            description: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\n\nLocation: ${location || "Not specified"}\nDate of Travel: ${travelDate || "Not specified"}\nItem Category: ${itemCategory || "Not specified"}\n\nItem Description:\n${description}`,
            creatorType: "customer",
            category: "lost-and-found",
            priority: "medium",
            tags: ["lost-item", itemCategory || "other"].filter(Boolean),
            metadata: {
              email,
              phone,
              location,
              travelDate,
              itemCategory,
            },
          },
        });
        setSubmitted(true);
        // Reset form
        setName("");
        setEmail("");
        setPhone("");
        setLocation(null);
        setTravelDate("");
        setItemCategory(null);
        setDescription("");
      },
    },
    [
      name,
      email,
      phone,
      location,
      travelDate,
      itemCategory,
      description,
      issueController,
    ],
  );

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-orange-9) 0%, var(--mantine-color-red-8) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <ThemeIcon size={60} radius="xl" color="white" variant="white">
              <IconLuggage size={30} />
            </ThemeIcon>
            <Title order={1} c="white">
              Lost & Found
            </Title>
            <Text size="lg" c="gray.3" maw={600}>
              Left something on board? Don't worry - we're here to help reunite
              you with your belongings. Most items are recovered and returned to
              their owners.
            </Text>
          </Stack>
        </Container>
      </Box>

      {/* Quick Stats */}
      <Container size="lg" mt={-40}>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Card withBorder radius="lg" p="lg" ta="center">
            <Stack gap={4}>
              <Text size="2rem" fw={700} c="green">
                85%
              </Text>
              <Text size="sm" c="dimmed">
                Items Recovered
              </Text>
            </Stack>
          </Card>
          <Card withBorder radius="lg" p="lg" ta="center">
            <Stack gap={4}>
              <Text size="2rem" fw={700} c="blue">
                24h
              </Text>
              <Text size="sm" c="dimmed">
                Average Processing Time
              </Text>
            </Stack>
          </Card>
          <Card withBorder radius="lg" p="lg" ta="center">
            <Stack gap={4}>
              <Text size="2rem" fw={700} c="orange">
                90 days
              </Text>
              <Text size="sm" c="dimmed">
                Item Retention Period
              </Text>
            </Stack>
          </Card>
        </SimpleGrid>
      </Container>

      {/* How It Works */}
      <Container size="lg" py={60}>
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Stack gap="lg">
              <Badge variant="light" color="orange" w="fit-content">
                How It Works
              </Badge>
              <Title order={2}>Recovering Your Item</Title>
              <Text c="dimmed">
                Our lost and found process is designed to get your belongings
                back to you as quickly as possible.
              </Text>

              <Timeline active={-1} bulletSize={32} lineWidth={2}>
                <Timeline.Item
                  bullet={<IconSearch size={16} />}
                  title="Report Your Item"
                >
                  <Text size="sm" c="dimmed">
                    Submit a lost item report online or call our support line
                    with details about what you lost and when.
                  </Text>
                </Timeline.Item>
                <Timeline.Item
                  bullet={<IconMapPin size={16} />}
                  title="We Search"
                >
                  <Text size="sm" c="dimmed">
                    Our team searches trains and stations. Items found are
                    logged and stored securely.
                  </Text>
                </Timeline.Item>
                <Timeline.Item
                  bullet={<IconMail size={16} />}
                  title="Get Notified"
                >
                  <Text size="sm" c="dimmed">
                    If we find your item, we'll contact you via email or phone
                    within 24-48 hours.
                  </Text>
                </Timeline.Item>
                <Timeline.Item
                  bullet={<IconCheck size={16} />}
                  title="Retrieve or Ship"
                >
                  <Text size="sm" c="dimmed">
                    Pick up your item at any station or have it shipped to you
                    for a small fee.
                  </Text>
                </Timeline.Item>
              </Timeline>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder radius="lg" p="xl">
              <Stack gap="lg">
                <Title order={3}>Report Lost Item</Title>

                {submitted && (
                  <Alert
                    icon={<IconCheck size={16} />}
                    color="green"
                    title="Report Submitted!"
                  >
                    Thank you for your report. We've logged your lost item and
                    will contact you if we locate it. Reference number will be
                    sent to your email.
                  </Alert>
                )}

                <TextInput
                  label="Your Name"
                  placeholder="Enter your full name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />

                <TextInput
                  label="Email Address"
                  placeholder="your@email.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                <TextInput
                  label="Phone Number"
                  placeholder="+1 (xxx) xxx-xxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />

                <Select
                  label="Station / Train"
                  placeholder="Where did you lose the item?"
                  value={location}
                  onChange={setLocation}
                  data={[
                    { group: "Stations", items: Stations },
                    {
                      group: "Trains",
                      items: [
                        "AR Corridor Service",
                        "The Canadian",
                        "The Ocean",
                      ],
                    },
                  ]}
                />

                <TextInput
                  label="Date of Travel"
                  type="date"
                  placeholder="When did you travel?"
                  value={travelDate}
                  onChange={(e) => setTravelDate(e.target.value)}
                />

                <Select
                  label="Item Category"
                  placeholder="What type of item?"
                  value={itemCategory}
                  onChange={setItemCategory}
                  data={commonItems}
                />

                <Textarea
                  label="Item Description"
                  placeholder="Please describe your item in detail (color, brand, distinguishing features, contents if a bag, etc.)"
                  minRows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />

                <ActionButton
                  fullWidth
                  size="lg"
                  loading={submitAction.loading}
                  disabled={!name || !email || !description}
                  onClick={() => submitAction.run()}
                >
                  Submit Report
                </ActionButton>

                <Text size="xs" c="dimmed" ta="center">
                  You will receive a confirmation email with a reference number.
                </Text>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </Container>

      {/* Contact & Tips */}
      <Box bg="var(--mantine-color-orange-light)" py={60}>
        <Container size="lg">
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder radius="lg" p="xl" h="100%">
                <Stack gap="lg">
                  <Group gap="md">
                    <ThemeIcon size="lg" color="orange" variant="light">
                      <IconPhone size={20} />
                    </ThemeIcon>
                    <Title order={3}>Contact Lost & Found</Title>
                  </Group>

                  <Stack gap="md">
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Lost & Found Hotline
                      </Text>
                      <Text fw={600}>1-888-ALEPHA-L</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Email
                      </Text>
                      <Text fw={600}>lostandfound@alepharail.ca</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Hours
                      </Text>
                      <Text fw={600}>7am - 10pm ET, 7 days</Text>
                    </Group>
                  </Stack>

                  <Text size="sm" c="dimmed">
                    For valuable items (electronics, documents, wallets), please
                    contact us immediately for priority processing.
                  </Text>
                </Stack>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder radius="lg" p="xl" h="100%">
                <Stack gap="lg">
                  <Group gap="md">
                    <ThemeIcon size="lg" color="blue" variant="light">
                      <IconAlertCircle size={20} />
                    </ThemeIcon>
                    <Title order={3}>Tips to Prevent Loss</Title>
                  </Group>

                  <List spacing="sm">
                    <List.Item>
                      <Text size="sm">
                        Check your seat and overhead bin before leaving the
                        train
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text size="sm">
                        Keep valuables in a bag that stays with you
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text size="sm">
                        Take photos of luggage and serial numbers of electronics
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text size="sm">
                        Use luggage tags with your contact information
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text size="sm">
                        Set a phone reminder 10 minutes before arrival
                      </Text>
                    </List.Item>
                  </List>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* CTA */}
      <Container size="md" py={60}>
        <Card withBorder radius="lg" p="xl" ta="center">
          <Stack align="center" gap="lg">
            <Title order={2}>Need More Help?</Title>
            <Text c="dimmed" maw={500}>
              Our customer service team is available to assist with any
              questions about lost items or your travel experience.
            </Text>
            <Group>
              <ActionButton
                variant="light"
                onClick={() => router.go("helpCentre")}
              >
                Help Centre
              </ActionButton>
              <ActionButton
                rightSection={<IconArrowRight size={16} />}
                onClick={() => router.go("contact")}
              >
                Contact Us
              </ActionButton>
            </Group>
          </Stack>
        </Card>
      </Container>

      <Footer />
    </Box>
  );
};

export default LostAndFound;
