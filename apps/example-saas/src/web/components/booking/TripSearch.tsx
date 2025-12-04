import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Avatar,
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Flex,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconAccessible,
  IconArrowRight,
  IconBolt,
  IconBrandApple,
  IconBrandFacebook,
  IconBrandGoogle,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandMastercard,
  IconBrandPaypal,
  IconBrandVisa,
  IconBrandX,
  IconCalendar,
  IconCheck,
  IconClock,
  IconLeaf,
  IconLock,
  IconMapPin,
  IconPlane,
  IconShieldCheck,
  IconSparkles,
  IconTrain,
  IconUsers,
  IconWorld,
} from "@tabler/icons-react";
import { motion, type Variants } from "framer-motion";
import { useMemo, useState } from "react";
import type { StationResource } from "../../../api/schemas/stationSchema.ts";
import type { Trip } from "../../../api/schemas/tripSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";

// Animation variants - subtle
const fadeIn: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const cardHover = {
  y: -4,
  transition: { duration: 0.2 },
};

/**
 * Props passed from $page resolve (SSR data fetching)
 */
export interface TripSearchProps {
  stations: StationResource[];
  popularRoutes: Trip[];
}

const TripSearch = (props: TripSearchProps) => {
  const router = useRouter<AppRouter>();
  const [tripType, setTripType] = useState("one-way");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [passengers, setPassengers] = useState<number | string>(1);
  const [loading, setLoading] = useState(false);

  const stationOptions = useMemo(
    () => props.stations.map((s) => ({ value: s.name, label: s.name })),
    [props.stations],
  );

  const handleSearch = async () => {
    if (!from || !to || !date) return;

    setLoading(true);
    try {
      await router.go("bookingResults", {
        query: {
          from,
          to,
          date: date.toISOString().split("T")[0],
          passengers: String(passengers),
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const isValid = from && to && date && from !== to;

  return (
    <Flex flex={1} direction="column" bg="var(--alepha-background)">
      {/* Hero Section */}
      <Box bg="dark.9" pos="relative" style={{ overflow: "hidden" }}>
        {/* Subtle grid pattern */}
        <Box
          pos="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
            `,
            backgroundSize: "64px 64px",
          }}
        />

        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          <Container size="lg" py={100} pos="relative">
            <Stack align="center" gap="xl">
              {/* Badge */}
              <motion.div variants={fadeIn}>
                <Badge
                  size="lg"
                  variant="outline"
                  color="gray"
                  radius="xl"
                  leftSection={<IconSparkles size={14} />}
                  styles={{
                    root: {
                      borderColor: "rgba(255,255,255,0.2)",
                      color: "rgba(255,255,255,0.7)",
                      textTransform: "none",
                      fontWeight: 500,
                    },
                  }}
                >
                  Government of Canada Initiative
                </Badge>
              </motion.div>

              {/* Main heading */}
              <motion.div variants={fadeIn}>
                <Title
                  order={1}
                  c="white"
                  ta="center"
                  fz={{ base: 40, sm: 56, md: 72 }}
                  fw={700}
                  lh={1.1}
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Connect Canada
                  <br />
                  <Text
                    span
                    inherit
                    variant="gradient"
                    gradient={{ from: "gray.5", to: "white", deg: 90 }}
                  >
                    at High Speed
                  </Text>
                </Title>
              </motion.div>

              {/* Subtitle */}
              <motion.div variants={fadeIn}>
                <Text c="dark.2" size="xl" ta="center" maw={540} lh={1.6}>
                  Vectura is Canada's new high-speed rail network. Sustainable,
                  accessible, and connecting major cities in record time.
                </Text>
              </motion.div>

              {/* Trust indicators */}
              <motion.div variants={fadeIn}>
                <Group gap="xl" mt="md">
                  {[
                    { icon: IconLeaf, text: "Carbon Neutral" },
                    { icon: IconAccessible, text: "Fully Accessible" },
                    { icon: IconShieldCheck, text: "Government Backed" },
                  ].map((item) => (
                    <Group key={item.text} gap={6}>
                      <item.icon
                        size={16}
                        color="var(--mantine-color-dark-3)"
                      />
                      <Text size="sm" c="dark.3">
                        {item.text}
                      </Text>
                    </Group>
                  ))}
                </Group>
              </motion.div>
            </Stack>
          </Container>
        </motion.div>
      </Box>

      {/* Search Card */}
      <Container size="md" mt={-50} pos="relative" style={{ zIndex: 1 }}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Card
            withBorder
            shadow="xl"
            radius="lg"
            p="xl"
            bg="var(--alepha-elevated)"
            bd="1px solid var(--alepha-border)"
          >
            <Stack gap="lg">
              <Group justify="space-between" align="center">
                <Badge
                  size="lg"
                  variant={tripType === "one-way" ? "filled" : "light"}
                  color="dark"
                  radius="md"
                  onClick={() => setTripType("one-way")}
                  style={{ cursor: "pointer" }}
                >
                  One Way
                </Badge>
                <Badge
                  size="lg"
                  variant={tripType === "round-trip" ? "filled" : "light"}
                  color="dark"
                  radius="md"
                  onClick={() => setTripType("round-trip")}
                  style={{ cursor: "pointer" }}
                >
                  Round Trip
                </Badge>
                <Box flex={1} />
                <Group gap="xs">
                  <IconLeaf size={16} color="var(--mantine-color-green-6)" />
                  <Text size="sm" c="dimmed">
                    100% electric powered
                  </Text>
                </Group>
              </Group>

              <Group grow align="flex-start">
                <Select
                  label="From"
                  placeholder="Departure station"
                  data={stationOptions}
                  value={from}
                  onChange={setFrom}
                  searchable
                  leftSection={<IconMapPin size={16} />}
                  required
                  size="md"
                  radius="md"
                />
                <Select
                  label="To"
                  placeholder="Arrival station"
                  data={stationOptions}
                  value={to}
                  onChange={setTo}
                  searchable
                  leftSection={<IconMapPin size={16} />}
                  required
                  size="md"
                  radius="md"
                />
              </Group>

              <Group grow align="flex-start">
                <DateInput
                  label="Date"
                  placeholder="Select date"
                  value={date}
                  onChange={(value) => setDate(value ? new Date(value) : null)}
                  minDate={new Date()}
                  leftSection={<IconCalendar size={16} />}
                  required
                  size="md"
                  radius="md"
                />
                <NumberInput
                  label="Passengers"
                  placeholder="Number of passengers"
                  value={passengers}
                  onChange={setPassengers}
                  min={1}
                  max={9}
                  leftSection={<IconUsers size={16} />}
                  required
                  size="md"
                  radius="md"
                />
              </Group>

              <ActionButton
                color="pink"
                variant="filled"
                size="xl"
                radius="md"
                rightSection={<IconArrowRight size={20} />}
                onClick={handleSearch}
                loading={loading}
                disabled={!isValid}
                fullWidth
              >
                Search Trains
              </ActionButton>

              <Group justify="center" gap="xl">
                {[
                  "Instant booking",
                  "Accessible seating",
                  "Free cancellation",
                ].map((text) => (
                  <Group key={text} gap={4}>
                    <IconCheck size={14} color="var(--mantine-color-green-6)" />
                    <Text size="xs" c="dimmed">
                      {text}
                    </Text>
                  </Group>
                ))}
              </Group>
            </Stack>
          </Card>
        </motion.div>
      </Container>

      {/* Features Section */}
      <Container size="lg" py={80}>
        <Stack gap={60}>
          {/* Section header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <Stack align="center" gap="xs">
              <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
                Why Choose Vectura
              </Text>
              <Title order={2} ta="center" fz={36} fw={700}>
                Built for all Canadians
              </Title>
            </Stack>
          </motion.div>

          {/* Feature cards */}
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="lg">
            {[
              {
                icon: IconLeaf,
                title: "Zero Emissions",
                desc: "100% electric trains powered by renewable Canadian energy sources",
              },
              {
                icon: IconBolt,
                title: "High-Speed",
                desc: "Travel at speeds up to 300 km/h between major Canadian cities",
              },
              {
                icon: IconAccessible,
                title: "Fully Accessible",
                desc: "Wheelchair spaces, audio announcements, and assistance at every station",
              },
              {
                icon: IconWorld,
                title: "Downtown to Downtown",
                desc: "Arrive directly in city centers, no airport transfers needed",
              },
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                whileHover={cardHover}
              >
                <Card
                  withBorder
                  radius="lg"
                  p="lg"
                  h="100%"
                  bg="var(--alepha-elevated)"
                  bd="1px solid var(--alepha-border)"
                >
                  <Stack gap="md">
                    <Flex
                      w={48}
                      h={48}
                      align="center"
                      justify="center"
                      bg="var(--alepha-surface)"
                      style={{ borderRadius: 12 }}
                    >
                      <feature.icon size={24} stroke={1.5} />
                    </Flex>
                    <Text fw={600} size="lg">
                      {feature.title}
                    </Text>
                    <Text size="sm" c="dimmed" lh={1.6}>
                      {feature.desc}
                    </Text>
                  </Stack>
                </Card>
              </motion.div>
            ))}
          </SimpleGrid>
        </Stack>
      </Container>

      {/* Stats Section */}
      <Box
        bg="var(--alepha-elevated)"
        py={60}
        bd="1px solid var(--alepha-border)"
        style={{ borderLeft: 0, borderRight: 0 }}
      >
        <Container size="lg">
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg">
            {[
              { value: "300", label: "km/h Top Speed" },
              { value: "12", label: "Major Cities" },
              { value: "100%", label: "Accessible" },
              { value: "0", label: "Carbon Emissions" },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Stack align="center" gap={4}>
                  <Text
                    fz={48}
                    fw={700}
                    lh={1}
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    {stat.value}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {stat.label}
                  </Text>
                </Stack>
              </motion.div>
            ))}
          </SimpleGrid>
        </Container>
      </Box>

      {/* Popular Routes Section */}
      {props.popularRoutes.length > 0 && (
        <Container size="lg" py={80}>
          <Stack gap={40}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <Group justify="space-between" align="flex-end">
                <Stack gap="xs">
                  <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
                    Popular Routes
                  </Text>
                  <Title order={2} fz={36} fw={700}>
                    Coast to coast connections
                  </Title>
                </Stack>
              </Group>
            </motion.div>

            <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="lg">
              {props.popularRoutes.map((route, index) => (
                <motion.div
                  key={route.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  whileHover={cardHover}
                >
                  <Card
                    withBorder
                    radius="lg"
                    p="lg"
                    bg="var(--alepha-elevated)"
                    bd="1px solid var(--alepha-border)"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setFrom(route.departureStation);
                      setTo(route.arrivalStation);
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      setDate(tomorrow);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <Stack gap="md">
                      <Group justify="space-between" align="center">
                        <Text fw={600}>
                          {route.departureStation.split(" ")[0]}
                        </Text>
                        <IconArrowRight
                          size={16}
                          color="var(--alepha-text-muted)"
                        />
                        <Text fw={600}>
                          {route.arrivalStation.split(" ")[0]}
                        </Text>
                      </Group>
                      <Divider color="var(--alepha-border)" />
                      <Group justify="space-between">
                        <Group gap={4}>
                          <IconClock
                            size={14}
                            color="var(--alepha-text-muted)"
                          />
                          <Text size="sm" c="dimmed">
                            {route.duration}
                          </Text>
                        </Group>
                        <Text fw={700}>${route.price} CAD</Text>
                      </Group>
                    </Stack>
                  </Card>
                </motion.div>
              ))}
            </SimpleGrid>
          </Stack>
        </Container>
      )}

      {/* Testimonials */}
      <Box
        bg="var(--alepha-elevated)"
        py={80}
        style={{ borderTop: "1px solid var(--alepha-border)" }}
      >
        <Container size="lg">
          <Stack gap={40}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <Stack align="center" gap="xs">
                <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
                  Testimonials
                </Text>
                <Title order={2} ta="center" fz={36} fw={700}>
                  Loved by Canadians
                </Title>
              </Stack>
            </motion.div>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
              {[
                {
                  name: "Sarah T.",
                  role: "Toronto, ON",
                  text: "Finally, a fast and sustainable way to travel between Toronto and Montreal. The accessibility features are excellent.",
                },
                {
                  name: "Jean-Pierre L.",
                  role: "Montreal, QC",
                  text: "Je voyage chaque semaine pour le travail. Vectura a changé ma vie - rapide, confortable et écologique.",
                },
                {
                  name: "Michael C.",
                  role: "Vancouver, BC",
                  text: "As a wheelchair user, I appreciate how Vectura was designed with accessibility in mind from day one.",
                },
              ].map((testimonial, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  whileHover={cardHover}
                >
                  <Card
                    withBorder
                    radius="lg"
                    p="xl"
                    h="100%"
                    bg="var(--alepha-background)"
                    bd="1px solid var(--alepha-border)"
                  >
                    <Stack gap="lg" h="100%" justify="space-between">
                      <Text size="md" lh={1.7} c="dimmed">
                        "{testimonial.text}"
                      </Text>
                      <Group gap="sm">
                        <Avatar color="dark" radius="xl" size="md">
                          {testimonial.name.charAt(0)}
                        </Avatar>
                        <Stack gap={0}>
                          <Text fw={600} size="sm">
                            {testimonial.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {testimonial.role}
                          </Text>
                        </Stack>
                      </Group>
                    </Stack>
                  </Card>
                </motion.div>
              ))}
            </SimpleGrid>
          </Stack>
        </Container>
      </Box>

      {/* Train vs Plane */}
      <Container size="lg" py={80}>
        <SimpleGrid
          cols={{ base: 1, md: 2 }}
          spacing={60}
          style={{ alignItems: "center" }}
        >
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <Stack gap="lg">
              <Text size="sm" c="dimmed" tt="uppercase" lts={2} fw={500}>
                Toronto to Montreal
              </Text>
              <Title order={2} fz={36} fw={700}>
                Skip the airport hassle
              </Title>
              <Text size="lg" c="dimmed" lh={1.7}>
                No security lines, no baggage fees, no stress. Board downtown
                Toronto and arrive in the heart of Montreal. Work, relax, or
                enjoy the scenic Canadian landscape.
              </Text>
              <Group gap="md">
                <Badge size="lg" variant="light" color="green" radius="md">
                  Zero Emissions
                </Badge>
                <Badge size="lg" variant="light" color="dark" radius="md">
                  Downtown to Downtown
                </Badge>
              </Group>
            </Stack>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card
              withBorder
              radius="lg"
              p="xl"
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
            >
              <Stack gap="lg">
                <Group justify="space-between">
                  <Group gap="sm">
                    <Flex
                      w={40}
                      h={40}
                      align="center"
                      justify="center"
                      bg="red.0"
                      style={{ borderRadius: 10 }}
                    >
                      <IconPlane size={20} color="var(--mantine-color-red-6)" />
                    </Flex>
                    <Text fw={600}>Flying</Text>
                  </Group>
                  <Text c="dimmed" size="sm">
                    ~3h 30min total
                  </Text>
                </Group>
                <Text size="sm" c="dimmed">
                  Drive to airport + security + boarding + flight + baggage +
                  transit
                </Text>

                <Divider color="var(--alepha-border)" />

                <Group justify="space-between">
                  <Group gap="sm">
                    <Flex
                      w={40}
                      h={40}
                      align="center"
                      justify="center"
                      bg="green.0"
                      style={{ borderRadius: 10 }}
                    >
                      <IconTrain
                        size={20}
                        color="var(--mantine-color-green-6)"
                      />
                    </Flex>
                    <Text fw={600}>Vectura</Text>
                  </Group>
                  <Text c="green" size="sm" fw={600}>
                    2h 30min
                  </Text>
                </Group>
                <Text size="sm" c="dimmed">
                  Walk to platform, board, arrive downtown Montreal
                </Text>
              </Stack>
            </Card>
          </motion.div>
        </SimpleGrid>
      </Container>

      {/* Payment Methods */}
      <Box py={40} style={{ borderTop: "1px solid var(--alepha-border)" }}>
        <Container size="lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <Stack gap="lg" align="center">
              <Text size="sm" c="dimmed">
                Secure payments
              </Text>
              <Group gap="xl">
                {[
                  { icon: IconBrandVisa, label: "Visa" },
                  { icon: IconBrandMastercard, label: "Mastercard" },
                  { icon: IconBrandPaypal, label: "PayPal" },
                  { icon: IconBrandApple, label: "Apple Pay" },
                  { icon: IconBrandGoogle, label: "Google Pay" },
                ].map((payment) => (
                  <Tooltip key={payment.label} label={payment.label}>
                    <motion.div whileHover={{ scale: 1.1 }}>
                      <Flex
                        w={48}
                        h={32}
                        align="center"
                        justify="center"
                        bg="var(--alepha-surface)"
                        style={{ borderRadius: 6 }}
                      >
                        <payment.icon
                          size={20}
                          color="var(--alepha-text-muted)"
                        />
                      </Flex>
                    </motion.div>
                  </Tooltip>
                ))}
              </Group>
              <Group gap="xl">
                <Group gap={4}>
                  <IconShieldCheck
                    size={14}
                    color="var(--mantine-color-green-6)"
                  />
                  <Text size="xs" c="dimmed">
                    256-bit SSL
                  </Text>
                </Group>
                <Group gap={4}>
                  <IconLock size={14} color="var(--alepha-text-muted)" />
                  <Text size="xs" c="dimmed">
                    PCI DSS Compliant
                  </Text>
                </Group>
              </Group>
            </Stack>
          </motion.div>
        </Container>
      </Box>

      {/* Footer */}
      <Box bg="dark.9" py={60}>
        <Container size="lg">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing={40}>
            {/* Brand */}
            <Stack gap="md">
              <Group gap="xs">
                <IconTrain size={24} color="white" />
                <Text size="lg" fw={700} c="white">
                  Vectura
                </Text>
              </Group>
              <Text size="sm" c="dark.2" lh={1.6}>
                Canada's high-speed rail network. A Government of Canada
                initiative connecting communities sustainably.
              </Text>
              <Group gap="xs">
                {[
                  IconBrandX,
                  IconBrandFacebook,
                  IconBrandInstagram,
                  IconBrandLinkedin,
                ].map((Icon, i) => (
                  <motion.div key={i} whileHover={{ scale: 1.1 }}>
                    <Flex
                      w={36}
                      h={36}
                      align="center"
                      justify="center"
                      bg="dark.7"
                      style={{ borderRadius: 8, cursor: "pointer" }}
                    >
                      <Icon size={18} color="white" />
                    </Flex>
                  </motion.div>
                ))}
              </Group>
            </Stack>

            {/* Links */}
            {[
              {
                title: "Travel",
                links: ["Book", "Routes", "Schedules", "Stations"],
              },
              {
                title: "Support",
                links: [
                  "Help Centre",
                  "Accessibility",
                  "Lost & Found",
                  "Contact",
                ],
              },
              {
                title: "About",
                links: ["Our Mission", "Sustainability", "Careers", "Press"],
              },
            ].map((section) => (
              <Stack key={section.title} gap="md">
                <Text size="sm" fw={600} c="white">
                  {section.title}
                </Text>
                <Stack gap="xs">
                  {section.links.map((link) => (
                    <Text
                      key={link}
                      size="sm"
                      c="dark.2"
                      style={{ cursor: "pointer" }}
                    >
                      {link}
                    </Text>
                  ))}
                </Stack>
              </Stack>
            ))}
          </SimpleGrid>

          <Divider my={40} color="dark.6" />

          <Group justify="space-between">
            <Text size="xs" c="dark.3">
              © 2024 Vectura Canada Inc. All rights reserved.
            </Text>
            <Group gap="xl">
              <Group gap={4}>
                <IconAccessible size={14} color="var(--mantine-color-dark-3)" />
                <Text size="xs" c="dark.3">
                  AODA Compliant
                </Text>
              </Group>
              <Group gap={4}>
                <IconLeaf size={14} color="var(--mantine-color-dark-3)" />
                <Text size="xs" c="dark.3">
                  Carbon Neutral
                </Text>
              </Group>
            </Group>
          </Group>
        </Container>
      </Box>
    </Flex>
  );
};

export default TripSearch;
