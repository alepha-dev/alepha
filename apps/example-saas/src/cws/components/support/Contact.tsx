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
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandX,
  IconBuilding,
  IconCheck,
  IconClock,
  IconHeadset,
  IconMail,
  IconMapPin,
  IconPhone,
  IconSend,
} from "@tabler/icons-react";
import { $client } from "alepha/server/links";
import { useState } from "react";
import type { IssueController } from "../../../api/issues/controllers/IssueController.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const contactMethods = [
  {
    icon: IconPhone,
    title: "Phone",
    description: "Speak with a customer service agent",
    detail: "1-888-ALEPHA-1",
    subdetail: "24/7 Available",
    color: "blue",
  },
  {
    icon: IconHeadset,
    title: "Live Chat",
    description: "Chat with our support team online",
    detail: "Start a chat",
    subdetail: "Average wait: 2 minutes",
    color: "green",
  },
  {
    icon: IconMail,
    title: "Email",
    description: "Send us a detailed inquiry",
    detail: "support@alepharail.ca",
    subdetail: "Response within 24 hours",
    color: "violet",
  },
];

const offices = [
  {
    city: "Toronto",
    address: "65 Front Street West, Toronto, ON M5J 1E6",
    phone: "(416) 555-RAIL",
  },
  {
    city: "Montr&eacute;al",
    address:
      "895 rue de la Gaucheti&egrave;re Ouest, Montr&eacute;al, QC H3B 4G1",
    phone: "(514) 555-RAIL",
  },
  {
    city: "Vancouver",
    address: "1150 Station Street, Vancouver, BC V6A 4C7",
    phone: "(604) 555-RAIL",
  },
];

const socialLinks = [
  { icon: IconBrandX, name: "X (Twitter)", handle: "@AlephaRail" },
  { icon: IconBrandFacebook, name: "Facebook", handle: "/AlephaRail" },
  { icon: IconBrandInstagram, name: "Instagram", handle: "@AlephaRail" },
  { icon: IconBrandLinkedin, name: "LinkedIn", handle: "/company/alepharail" },
];

const Contact = () => {
  const router = useRouter<CwsRouter>();
  const issueController = $client<IssueController>();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState<string | null>(null);
  const [bookingRef, setBookingRef] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitAction = useAction(
    {
      handler: async () => {
        await issueController.createIssue({
          body: {
            title: `Contact: ${subject || "General Inquiry"} - ${firstName} ${lastName}`,
            description: `Name: ${firstName} ${lastName}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nBooking Reference: ${bookingRef || "N/A"}\n\nMessage:\n${message}`,
            creatorType: "customer",
            category: subject || "general",
            priority: "medium",
            tags: ["contact-form"],
            metadata: {
              email,
              phone,
              bookingRef,
              subject,
            },
          },
        });
        setSubmitted(true);
        // Reset form
        setFirstName("");
        setLastName("");
        setEmail("");
        setPhone("");
        setSubject(null);
        setBookingRef("");
        setMessage("");
      },
    },
    [
      firstName,
      lastName,
      email,
      phone,
      subject,
      bookingRef,
      message,
      issueController,
    ],
  );

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-indigo-9) 0%, var(--mantine-color-blue-8) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <ThemeIcon size={60} radius="xl" color="white" variant="white">
              <IconMail size={30} />
            </ThemeIcon>
            <Title order={1} c="white">
              Contact Us
            </Title>
            <Text size="lg" c="gray.3" maw={600}>
              Have questions, feedback, or need assistance? We're here to help.
              Choose the contact method that works best for you.
            </Text>
          </Stack>
        </Container>
      </Box>

      {/* Contact Methods */}
      <Container size="lg" mt={-40}>
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          {contactMethods.map((method) => (
            <Card
              key={method.title}
              withBorder
              radius="lg"
              p="xl"
              ta="center"
              style={{ cursor: "pointer" }}
            >
              <Stack align="center" gap="md">
                <ThemeIcon
                  size={50}
                  radius="xl"
                  color={method.color}
                  variant="light"
                >
                  <method.icon size={24} />
                </ThemeIcon>
                <Title order={4}>{method.title}</Title>
                <Text size="sm" c="dimmed">
                  {method.description}
                </Text>
                <Text fw={600} size="lg">
                  {method.detail}
                </Text>
                <Badge variant="light" color={method.color}>
                  {method.subdetail}
                </Badge>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      </Container>

      {/* Contact Form */}
      <Container size="lg" py={60}>
        <Grid>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card withBorder radius="lg" p="xl">
              <Stack gap="lg">
                <Stack gap="xs">
                  <Title order={2}>Send Us a Message</Title>
                  <Text size="sm" c="dimmed">
                    Fill out the form below and we'll get back to you within 24
                    hours.
                  </Text>
                </Stack>

                {submitted && (
                  <Alert
                    icon={<IconCheck size={16} />}
                    color="green"
                    title="Message Sent!"
                  >
                    Thank you for contacting us. We've received your message and
                    will respond within 24 hours.
                  </Alert>
                )}

                <Grid>
                  <Grid.Col span={6}>
                    <TextInput
                      label="First Name"
                      placeholder="Your first name"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <TextInput
                      label="Last Name"
                      placeholder="Your last name"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </Grid.Col>
                </Grid>

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
                  label="Subject"
                  placeholder="What's this about?"
                  value={subject}
                  onChange={setSubject}
                  data={[
                    "Booking Inquiry",
                    "Refund Request",
                    "Feedback",
                    "Accessibility Services",
                    "Lost & Found",
                    "Corporate Travel",
                    "Media Inquiry",
                    "Partnership Opportunity",
                    "Other",
                  ]}
                />

                <TextInput
                  label="Booking Reference (if applicable)"
                  placeholder="e.g., AR-123456"
                  value={bookingRef}
                  onChange={(e) => setBookingRef(e.target.value)}
                />

                <Textarea
                  label="Message"
                  placeholder="Please describe how we can help you..."
                  minRows={5}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />

                <ActionButton
                  fullWidth
                  size="lg"
                  leftSection={<IconSend size={18} />}
                  loading={submitAction.loading}
                  disabled={!firstName || !lastName || !email || !message}
                  onClick={() => submitAction.run()}
                >
                  Send Message
                </ActionButton>
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="lg">
              {/* Operating Hours */}
              <Card withBorder radius="lg" p="xl">
                <Stack gap="md">
                  <Group gap="md">
                    <ThemeIcon size="lg" color="blue" variant="light">
                      <IconClock size={20} />
                    </ThemeIcon>
                    <Title order={4}>Customer Service Hours</Title>
                  </Group>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="sm">Phone Support</Text>
                      <Text size="sm" fw={600}>
                        24/7
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">Live Chat</Text>
                      <Text size="sm" fw={600}>
                        6am - 12am ET
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">Email Response</Text>
                      <Text size="sm" fw={600}>
                        Within 24 hours
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">Station Offices</Text>
                      <Text size="sm" fw={600}>
                        6am - 10pm local
                      </Text>
                    </Group>
                  </Stack>
                </Stack>
              </Card>

              {/* Social Media */}
              <Card withBorder radius="lg" p="xl">
                <Stack gap="md">
                  <Title order={4}>Follow Us</Title>
                  <SimpleGrid cols={2}>
                    {socialLinks.map((social) => (
                      <Group key={social.name} gap="xs">
                        <ThemeIcon size="sm" variant="light" color="gray">
                          <social.icon size={14} />
                        </ThemeIcon>
                        <Stack gap={0}>
                          <Text size="xs" c="dimmed">
                            {social.name}
                          </Text>
                          <Text size="sm" fw={500}>
                            {social.handle}
                          </Text>
                        </Stack>
                      </Group>
                    ))}
                  </SimpleGrid>
                </Stack>
              </Card>

              {/* Quick Links */}
              <Card withBorder radius="lg" p="xl">
                <Stack gap="md">
                  <Title order={4}>Quick Links</Title>
                  <Stack gap="xs">
                    <ActionButton
                      variant="subtle"
                      justify="flex-start"
                      fullWidth
                      onClick={() => router.go("helpCentre")}
                    >
                      Help Centre & FAQs
                    </ActionButton>
                    <ActionButton
                      variant="subtle"
                      justify="flex-start"
                      fullWidth
                      onClick={() => router.go("lostAndFound")}
                    >
                      Lost & Found
                    </ActionButton>
                    <ActionButton
                      variant="subtle"
                      justify="flex-start"
                      fullWidth
                      onClick={() => router.go("accessibility")}
                    >
                      Accessibility Services
                    </ActionButton>
                  </Stack>
                </Stack>
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>
      </Container>

      {/* Offices */}
      <Box bg="var(--mantine-color-indigo-light)" py={60}>
        <Container size="lg">
          <Stack gap="xl">
            <Stack gap="xs" align="center" ta="center">
              <Title order={2}>Our Offices</Title>
              <Text c="dimmed">
                Visit us at one of our regional headquarters
              </Text>
            </Stack>

            <SimpleGrid cols={{ base: 1, md: 3 }}>
              {offices.map((office) => (
                <Card key={office.city} withBorder radius="lg" p="xl">
                  <Stack gap="md">
                    <Group gap="md">
                      <ThemeIcon size="lg" color="indigo" variant="light">
                        <IconBuilding size={20} />
                      </ThemeIcon>
                      <Title order={4}>{office.city}</Title>
                    </Group>
                    <Stack gap="xs">
                      <Group gap="xs">
                        <IconMapPin
                          size={14}
                          color="var(--mantine-color-dimmed)"
                        />
                        <Text size="sm" c="dimmed">
                          {office.address}
                        </Text>
                      </Group>
                      <Group gap="xs">
                        <IconPhone
                          size={14}
                          color="var(--mantine-color-dimmed)"
                        />
                        <Text size="sm" c="dimmed">
                          {office.phone}
                        </Text>
                      </Group>
                    </Stack>
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

export default Contact;
