import { useInject, useRouter, useStore } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
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
import type { AppRouter } from "../../AppRouter.ts";
import { bookingAtom } from "../../atoms/bookingAtom.ts";
import { BookingService } from "../../services/BookingService.ts";

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
        <Card withBorder p="xl" ta="center">
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
    <Flex flex={1} direction="column">
      <Flex
        bg="linear-gradient(135deg, var(--mantine-color-green-6) 0%, var(--mantine-color-teal-6) 100%)"
        py={60}
        justify="center"
        align="center"
        direction="column"
        gap="md"
      >
        <ThemeIcon size={80} radius="xl" color="white" variant="light">
          <IconCheck size={48} stroke={2.5} />
        </ThemeIcon>
        <Title order={1} c="white" ta="center">
          Welcome Aboard!
        </Title>
        <Text c="white" size="lg" ta="center" opacity={0.9}>
          Your booking is confirmed
        </Text>
        <Badge size="xl" color="white" variant="light" radius="md">
          Booking Reference: {booking.bookingReference}
        </Badge>
      </Flex>

      <Container size="lg" py="xl">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="lg">
            <Card withBorder radius="lg" p={0} style={{ overflow: "hidden" }}>
              <Flex
                bg="var(--mantine-color-blue-6)"
                p="md"
                justify="space-between"
                align="center"
              >
                <Group gap="xs">
                  <IconTicket size={24} color="white" />
                  <Text c="white" fw={600} size="lg">
                    E-Ticket
                  </Text>
                </Group>
                <Text c="white" size="sm">
                  {booking.search?.date}
                </Text>
              </Flex>

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
                    <IconTrain size={24} color="var(--mantine-color-blue-6)" />
                    <Text size="xs" c="dimmed">
                      {booking.selectedTrip.duration}
                    </Text>
                    <Badge variant="light" size="sm">
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

                <Divider variant="dashed" />

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
                        <Badge key={seat.id} variant="outline">
                          {seat.number}
                        </Badge>
                      ))}
                    </Group>
                  </Stack>
                </Group>

                <Divider variant="dashed" />

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
                    bg="var(--mantine-color-gray-1)"
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
                leftSection={<IconDownload size={18} />}
              >
                Download PDF
              </ActionButton>
              <ActionButton
                variant="light"
                leftSection={<IconMail size={18} />}
              >
                Email Ticket
              </ActionButton>
            </Group>
          </Stack>

          <Stack gap="lg">
            <Title order={3}>What's Next?</Title>

            <Card withBorder radius="md" p="lg">
              <Stack gap="md">
                <Group gap="md">
                  <ThemeIcon size="lg" radius="md" color="blue" variant="light">
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
                  <ThemeIcon size="lg" radius="md" color="blue" variant="light">
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
                  <ThemeIcon size="lg" radius="md" color="blue" variant="light">
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
                  <ThemeIcon size="lg" radius="md" color="blue" variant="light">
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
              bg="var(--mantine-color-blue-0)"
            >
              <Stack gap="sm">
                <Text fw={500}>Need help?</Text>
                <Text size="sm" c="dimmed">
                  Contact our customer service 24/7 at{" "}
                  <Text span fw={500} c="blue">
                    +33 1 23 45 67 89
                  </Text>{" "}
                  or email{" "}
                  <Text span fw={500} c="blue">
                    support@trainbooking.com
                  </Text>
                </Text>
              </Stack>
            </Card>

            <ActionButton
              variant="light"
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
