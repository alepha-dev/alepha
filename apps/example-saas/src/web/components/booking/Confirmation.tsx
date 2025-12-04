import { useInject, useRouter, useStore } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCheck,
  IconDownload,
  IconMail,
  IconMapPin,
  IconQrcode,
  IconTicket,
  IconTrain,
} from "@tabler/icons-react";
import { BookingService } from "../../../api/services/BookingService.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { bookingAtom } from "../../atoms/bookingAtom.ts";

const Confirmation = () => {
  const router = useRouter<AppRouter>();
  const bookingService = useInject(BookingService);
  const [booking] = useStore(bookingAtom);

  const handleNewBooking = async () => {
    bookingService.resetBooking();
    await router.go("bookingSearch");
  };

  if (!booking?.bookingReference || !booking?.selectedTrip) {
    return (
      <Container size="md" py="xl">
        <Card
          withBorder
          p="xl"
          ta="center"
          bg="var(--alepha-elevated)"
          bd="1px solid var(--alepha-border)"
        >
          <Stack gap="md" align="center">
            <Text c="dimmed">No booking found</Text>
            <ActionButton href={router.path("bookingSearch")}>
              Book a Trip
            </ActionButton>
          </Stack>
        </Card>
      </Container>
    );
  }

  return (
    <Flex flex={1} direction="column" bg="var(--alepha-background)">
      {/* Success Header with grid pattern */}
      <Box bg="dark.9" pos="relative" style={{ overflow: "hidden" }}>
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
        <Container size="lg" py={60} pos="relative">
          <Flex justify="center" align="center" direction="column" gap="md">
            <ThemeIcon size={80} radius="xl" color="green" variant="light">
              <IconCheck size={48} stroke={2.5} />
            </ThemeIcon>
            <Title order={1} c="white" ta="center">
              Welcome Aboard!
            </Title>
            <Text c="dark.3" size="lg" ta="center">
              Your booking is confirmed
            </Text>
            <Badge
              size="xl"
              variant="outline"
              radius="md"
              styles={{
                root: {
                  borderColor: "rgba(255,255,255,0.3)",
                  color: "white",
                },
              }}
            >
              Booking Reference: {booking.bookingReference}
            </Badge>
          </Flex>
        </Container>
      </Box>

      <Container size="lg" py="xl">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="lg">
            <Card
              withBorder
              radius="lg"
              p={0}
              style={{ overflow: "hidden" }}
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
            >
              <Box bg="dark.9" p="md">
                <Group justify="space-between" align="center">
                  <Group gap="xs">
                    <IconTicket size={24} color="white" />
                    <Text c="white" fw={600} size="lg">
                      E-Ticket
                    </Text>
                  </Group>
                  <Text c="dark.3" size="sm">
                    {booking.search?.date}
                  </Text>
                </Group>
              </Box>

              <Stack p="lg" gap="lg">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed" tt="uppercase">
                      From
                    </Text>
                    <Text fw={600}>{booking.search?.from}</Text>
                    <Text size="xl" fw={700}>
                      {booking.selectedTrip.departureTime}
                    </Text>
                  </Stack>

                  <Stack align="center" gap={4}>
                    <IconTrain size={24} />
                    <Text size="xs" c="dimmed">
                      {booking.selectedTrip.duration}
                    </Text>
                    <Badge variant="light" size="sm" color="dark">
                      Direct
                    </Badge>
                  </Stack>

                  <Stack gap={4} align="flex-end">
                    <Text size="xs" c="dimmed" tt="uppercase">
                      To
                    </Text>
                    <Text fw={600}>{booking.search?.to}</Text>
                    <Text size="xl" fw={700}>
                      {booking.selectedTrip.arrivalTime}
                    </Text>
                  </Stack>
                </Group>

                <Divider variant="dashed" color="var(--alepha-border)" />

                <Group justify="space-between">
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed" tt="uppercase">
                      Train
                    </Text>
                    <Text fw={500}>{booking.selectedTrip.trainNumber}</Text>
                    <Text size="sm" c="dimmed">
                      {booking.selectedTrip.trainType}
                    </Text>
                  </Stack>

                  <Stack gap={4} align="flex-end">
                    <Text size="xs" c="dimmed" tt="uppercase">
                      Seats
                    </Text>
                    <Group gap="xs">
                      {booking.selectedSeats?.map((seat) => (
                        <Badge key={seat.id} variant="outline" color="dark">
                          {seat.number}
                        </Badge>
                      ))}
                    </Group>
                  </Stack>
                </Group>

                <Divider variant="dashed" color="var(--alepha-border)" />

                <Group justify="space-between" align="center">
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed" tt="uppercase">
                      Passenger
                    </Text>
                    <Text fw={500}>
                      {booking.passenger?.firstName}{" "}
                      {booking.passenger?.lastName}
                    </Text>
                  </Stack>

                  <Paper
                    p="md"
                    radius="md"
                    bg="var(--alepha-surface)"
                    style={{ textAlign: "center" }}
                  >
                    <IconQrcode size={80} stroke={1} />
                    <Text size="xs" c="dimmed" mt="xs">
                      {booking.bookingReference}
                    </Text>
                  </Paper>
                </Group>
              </Stack>
            </Card>

            <Group grow>
              <ActionButton
                variant="light"
                color="dark"
                leftSection={<IconDownload size={18} />}
              >
                Download PDF
              </ActionButton>
              <ActionButton
                variant="light"
                color="dark"
                leftSection={<IconMail size={18} />}
              >
                Email Ticket
              </ActionButton>
            </Group>
          </Stack>

          <Stack gap="lg">
            <Title order={3}>What's Next?</Title>

            <Card
              withBorder
              radius="md"
              p="lg"
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
            >
              <Stack gap="md">
                <Group gap="md">
                  <ThemeIcon size="lg" radius="md" color="dark" variant="light">
                    <IconMail size={20} />
                  </ThemeIcon>
                  <Stack gap={2}>
                    <Text fw={500}>Check your email</Text>
                    <Text size="sm" c="dimmed">
                      We've sent your e-ticket to {booking.passenger?.email}
                    </Text>
                  </Stack>
                </Group>

                <Group gap="md">
                  <ThemeIcon size="lg" radius="md" color="dark" variant="light">
                    <IconTicket size={20} />
                  </ThemeIcon>
                  <Stack gap={2}>
                    <Text fw={500}>Save your ticket</Text>
                    <Text size="sm" c="dimmed">
                      Download or print your e-ticket before your journey
                    </Text>
                  </Stack>
                </Group>

                <Group gap="md">
                  <ThemeIcon size="lg" radius="md" color="dark" variant="light">
                    <IconMapPin size={20} />
                  </ThemeIcon>
                  <Stack gap={2}>
                    <Text fw={500}>Arrive at the station</Text>
                    <Text size="sm" c="dimmed">
                      Be at {booking.search?.from} at least 30 minutes before
                      departure
                    </Text>
                  </Stack>
                </Group>

                <Group gap="md">
                  <ThemeIcon size="lg" radius="md" color="dark" variant="light">
                    <IconTrain size={20} />
                  </ThemeIcon>
                  <Stack gap={2}>
                    <Text fw={500}>Board the train</Text>
                    <Text size="sm" c="dimmed">
                      Find your seat{" "}
                      {booking.selectedSeats?.map((s) => s.number).join(", ")}{" "}
                      and enjoy your journey!
                    </Text>
                  </Stack>
                </Group>
              </Stack>
            </Card>

            <Card
              withBorder
              radius="md"
              p="lg"
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
            >
              <Stack gap="sm">
                <Text fw={500}>Need help?</Text>
                <Text size="sm" c="dimmed">
                  Contact our customer service 24/7 at{" "}
                  <Text span fw={500}>
                    1-800-VECTURA
                  </Text>{" "}
                  or email{" "}
                  <Text span fw={500}>
                    support@vectura.ca
                  </Text>
                </Text>
              </Stack>
            </Card>

            <ActionButton
              variant="light"
              color="dark"
              size="lg"
              onClick={handleNewBooking}
              leftSection={<IconTrain size={20} />}
            >
              Book Another Trip
            </ActionButton>
          </Stack>
        </SimpleGrid>
      </Container>
    </Flex>
  );
};

export default Confirmation;
