import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Accordion,
  Badge,
  Box,
  Card,
  Container,
  Grid,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCreditCard,
  IconHeadset,
  IconHelp,
  IconLuggage,
  IconMail,
  IconPhone,
  IconSearch,
  IconTicket,
  IconTrain,
} from "@tabler/icons-react";
import { useState } from "react";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

const categories = [
  {
    icon: IconTicket,
    title: "Booking & Tickets",
    description: "Help with reservations, ticket changes, and cancellations",
    color: "blue",
  },
  {
    icon: IconCreditCard,
    title: "Payment & Refunds",
    description: "Payment methods, refund policies, and billing questions",
    color: "green",
  },
  {
    icon: IconTrain,
    title: "On Board",
    description: "Amenities, WiFi, dining, and accessibility",
    color: "orange",
  },
  {
    icon: IconLuggage,
    title: "Luggage",
    description: "Baggage allowance, oversized items, and storage",
    color: "violet",
  },
];

const faqItems = [
  {
    question: "How do I change or cancel my booking?",
    answer:
      "You can change or cancel your booking through your account on our website or app. Log in, go to 'My Trips', and select the booking you wish to modify. Changes are subject to fare conditions and availability. Economy Plus and Business class tickets can be changed free of charge up to 24 hours before departure.",
  },
  {
    question: "What is the baggage allowance?",
    answer:
      "Each passenger can bring 2 pieces of carry-on baggage (max 23kg each) and 2 checked bags (max 23kg each) at no additional cost. Oversized items like bicycles and skis require advance booking and may incur a fee. Musical instruments can be brought as carry-on if they fit in the overhead compartment.",
  },
  {
    question: "Is WiFi available on trains?",
    answer:
      "Yes, free WiFi is available on all AlephaRail services. Business class passengers enjoy priority bandwidth. Note that connectivity may be limited in remote areas during transcontinental journeys through the Canadian Shield and Rocky Mountains.",
  },
  {
    question: "Can I bring my pet on board?",
    answer:
      "Small pets in carriers (max 10kg combined) are welcome on Corridor services for a fee of $25. Service animals are always permitted free of charge with documentation. Pets are not allowed on The Canadian or The Ocean long-distance services due to journey length.",
  },
  {
    question: "What accessibility services are available?",
    answer:
      "All AlephaRail stations and trains are fully accessible. We offer wheelchair spaces, accessible washrooms, priority boarding, and staff assistance. Please book accessibility services at least 48 hours before travel by calling our accessibility line or through your booking.",
  },
  {
    question: "How early should I arrive at the station?",
    answer:
      "For Corridor services, we recommend arriving at least 30 minutes before departure. For The Canadian and The Ocean, please arrive 60 minutes early to complete check-in and boarding procedures. Business class passengers can use our priority boarding lanes.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit cards (Visa, Mastercard, American Express), Interac debit, PayPal, Apple Pay, and Google Pay. Corporate accounts can pay by invoice. Gift cards and loyalty points can also be used for payment.",
  },
  {
    question: "How do I earn and redeem loyalty points?",
    answer:
      "AlephaRail Rewards members earn 1 point per $1 spent. Points can be redeemed for free travel, upgrades, lounge access, and partner rewards. Status tiers (Bronze, Silver, Gold, Platinum) unlock additional benefits like free upgrades and bonus points.",
  },
];

const HelpCentre = () => {
  const router = useRouter<CwsRouter>();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredFaqs = faqItems.filter(
    (item) =>
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-blue-9) 0%, var(--mantine-color-cyan-8) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <ThemeIcon size={60} radius="xl" color="white" variant="white">
              <IconHelp size={30} />
            </ThemeIcon>
            <Title order={1} c="white">
              Help Centre
            </Title>
            <Text size="lg" c="gray.3" maw={600}>
              Find answers to common questions about booking, travel, and our
              services. We're here to help make your journey smooth.
            </Text>

            <TextInput
              placeholder="Search for help..."
              size="lg"
              w={{ base: "100%", sm: 500 }}
              leftSection={<IconSearch size={20} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              styles={{
                input: {
                  backgroundColor: "white",
                },
              }}
            />
          </Stack>
        </Container>
      </Box>

      {/* Categories */}
      <Container size="lg" mt={-40}>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          {categories.map((category) => (
            <Card
              key={category.title}
              withBorder
              radius="lg"
              p="lg"
              style={{ cursor: "pointer" }}
            >
              <Stack gap="md" align="center" ta="center">
                <ThemeIcon
                  size={50}
                  radius="xl"
                  color={category.color}
                  variant="light"
                >
                  <category.icon size={24} />
                </ThemeIcon>
                <Stack gap={4}>
                  <Text fw={600}>{category.title}</Text>
                  <Text size="xs" c="dimmed">
                    {category.description}
                  </Text>
                </Stack>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      </Container>

      {/* FAQs */}
      <Container size="lg" py={60}>
        <Stack gap="xl">
          <Stack gap="xs" align="center" ta="center">
            <Title order={2}>Frequently Asked Questions</Title>
            <Text c="dimmed">Quick answers to common questions</Text>
          </Stack>

          <Accordion variant="separated" radius="lg">
            {filteredFaqs.map((item, index) => (
              <Accordion.Item key={index} value={`faq-${index}`}>
                <Accordion.Control>
                  <Text fw={500}>{item.question}</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm" c="dimmed">
                    {item.answer}
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>

          {filteredFaqs.length === 0 && (
            <Card withBorder radius="lg" p="xl" ta="center">
              <Stack align="center" gap="md">
                <IconSearch size={48} color="var(--mantine-color-dimmed)" />
                <Text c="dimmed">
                  No results found for "{searchQuery}". Try a different search
                  term or contact us directly.
                </Text>
              </Stack>
            </Card>
          )}
        </Stack>
      </Container>

      {/* Contact Options */}
      <Box bg="var(--mantine-color-blue-light)" py={60}>
        <Container size="lg">
          <Stack gap="xl">
            <Stack gap="xs" align="center" ta="center">
              <Title order={2}>Still Need Help?</Title>
              <Text c="dimmed">Our support team is here for you</Text>
            </Stack>

            <Grid>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Card withBorder radius="lg" p="xl" h="100%">
                  <Stack align="center" ta="center" gap="md">
                    <ThemeIcon
                      size={50}
                      radius="xl"
                      color="blue"
                      variant="light"
                    >
                      <IconPhone size={24} />
                    </ThemeIcon>
                    <Title order={4}>Call Us</Title>
                    <Text size="sm" c="dimmed">
                      Speak with a customer service agent
                    </Text>
                    <Text fw={600} size="lg">
                      1-888-ALEPHA-1
                    </Text>
                    <Badge variant="light">24/7 Available</Badge>
                  </Stack>
                </Card>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Card withBorder radius="lg" p="xl" h="100%">
                  <Stack align="center" ta="center" gap="md">
                    <ThemeIcon
                      size={50}
                      radius="xl"
                      color="green"
                      variant="light"
                    >
                      <IconHeadset size={24} />
                    </ThemeIcon>
                    <Title order={4}>Live Chat</Title>
                    <Text size="sm" c="dimmed">
                      Chat with our support team online
                    </Text>
                    <ActionButton>Start Chat</ActionButton>
                    <Badge variant="light" color="green">
                      Average wait: 2 min
                    </Badge>
                  </Stack>
                </Card>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Card withBorder radius="lg" p="xl" h="100%">
                  <Stack align="center" ta="center" gap="md">
                    <ThemeIcon
                      size={50}
                      radius="xl"
                      color="violet"
                      variant="light"
                    >
                      <IconMail size={24} />
                    </ThemeIcon>
                    <Title order={4}>Email Us</Title>
                    <Text size="sm" c="dimmed">
                      Send us a detailed inquiry
                    </Text>
                    <Text fw={600}>support@alepharail.ca</Text>
                    <Badge variant="light" color="violet">
                      Response in 24h
                    </Badge>
                  </Stack>
                </Card>
              </Grid.Col>
            </Grid>
          </Stack>
        </Container>
      </Box>

      {/* Quick Links */}
      <Container size="md" py={60}>
        <Card withBorder radius="lg" p="xl">
          <Stack gap="lg">
            <Title order={3} ta="center">
              Quick Links
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <ActionButton
                variant="subtle"
                size="lg"
                justify="flex-start"
                leftSection={<IconTicket size={18} />}
                onClick={() => router.go("bookingSearch")}
              >
                Book a Trip
              </ActionButton>
              <ActionButton
                variant="subtle"
                size="lg"
                justify="flex-start"
                leftSection={<IconTrain size={18} />}
                onClick={() => router.go("routes")}
              >
                View Routes
              </ActionButton>
              <ActionButton
                variant="subtle"
                size="lg"
                justify="flex-start"
                leftSection={<IconLuggage size={18} />}
                onClick={() => router.go("lostAndFound")}
              >
                Lost & Found
              </ActionButton>
              <ActionButton
                variant="subtle"
                size="lg"
                justify="flex-start"
                leftSection={<IconHelp size={18} />}
                onClick={() => router.go("accessibility")}
              >
                Accessibility
              </ActionButton>
            </SimpleGrid>
          </Stack>
        </Card>
      </Container>

      <Footer />
    </Box>
  );
};

export default HelpCentre;
