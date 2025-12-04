import { useInject, useRouter, useStore } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Container,
  Divider,
  Group,
  Stack,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowRight,
  IconClock,
  IconTrain,
  IconUsers,
} from "@tabler/icons-react";
import { useMemo } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import { bookingAtom, type Trip } from "../../atoms/bookingAtom.ts";
import { BookingService } from "../../services/BookingService.ts";

const TripResults = () => {
  const router = useRouter<AppRouter>();
  const bookingService = useInject(BookingService);
  const [booking] = useStore(bookingAtom);

  const trips = useMemo(() => {
    if (!booking?.search) return [];
    return bookingService.searchTrips(
      booking.search.from,
      booking.search.to,
      booking.search.date,
    );
  }, [booking?.search]);

  const handleSelectTrip = async (trip: Trip) => {
    bookingService.updateBooking({
      step: "seats",
      selectedTrip: trip,
    });
    await router.go("bookingSeats");
  };

  if (!booking?.search) {
    return (
      <Container size="md" py="xl">
        <Card withBorder p="xl" ta="center">
          <Stack gap="md" align="center">
            <Text c="dimmed">No search criteria found</Text>
            <ActionButton href={router.path("bookingSearch")}>
              Start New Search
            </ActionButton>
          </Stack>
        </Card>
      </Container>
    );
  }

  return (
    <Flex flex={1} direction="column">
      <Flex bg="var(--mantine-color-blue-6)" py="lg" px="xl">
        <Container size="lg" w="100%">
          <Group justify="space-between" align="center">
            <Group gap="lg">
              <ActionButton
                variant="subtle"
                c="white"
                leftSection={<IconArrowLeft size={18} />}
                href={router.path("bookingSearch")}
              >
                Back
              </ActionButton>
              <Divider orientation="vertical" color="blue.4" />
              <Group gap="xs">
                <Text c="white" fw={600}>
                  {booking.search.from}
                </Text>
                <IconArrowRight size={16} color="white" />
                <Text c="white" fw={600}>
                  {booking.search.to}
                </Text>
              </Group>
            </Group>
            <Group gap="md">
              <Badge
                variant="light"
                color="white"
                size="lg"
                leftSection={<IconUsers size={14} />}
              >
                {booking.search.passengers} passenger
                {booking.search.passengers > 1 ? "s" : ""}
              </Badge>
              <Badge variant="light" color="white" size="lg">
                {booking.search.date}
              </Badge>
            </Group>
          </Group>
        </Container>
      </Flex>

      <Container size="lg" py="xl">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Title order={3}>{trips.length} trains available</Title>
            <Text c="dimmed" size="sm">
              Prices shown are per passenger
            </Text>
          </Group>

          {trips.map((trip) => (
            <Card key={trip.id} withBorder radius="md" p={0}>
              <Flex>
                <Flex flex={1} p="lg" direction="column" gap="md">
                  <Group justify="space-between" align="flex-start">
                    <Group gap="lg">
                      <Stack gap={4} align="center">
                        <Text size="xl" fw={700}>
                          {trip.departureTime}
                        </Text>
                        <Text size="sm" c="dimmed" maw={150} ta="center">
                          {trip.departureStation}
                        </Text>
                      </Stack>

                      <Stack gap={4} align="center">
                        <Group gap="xs">
                          <Divider w={60} />
                          <Flex
                            align="center"
                            gap={4}
                            c="dimmed"
                            style={{ whiteSpace: "nowrap" }}
                          >
                            <IconClock size={14} />
                            <Text size="xs">{trip.duration}</Text>
                          </Flex>
                          <Divider w={60} />
                        </Group>
                        <Badge variant="light" size="sm">
                          Direct
                        </Badge>
                      </Stack>

                      <Stack gap={4} align="center">
                        <Text size="xl" fw={700}>
                          {trip.arrivalTime}
                        </Text>
                        <Text size="sm" c="dimmed" maw={150} ta="center">
                          {trip.arrivalStation}
                        </Text>
                      </Stack>
                    </Group>

                    <Stack gap={4} align="flex-end">
                      <Group gap="xs">
                        <IconTrain size={16} />
                        <Text size="sm" fw={500}>
                          {trip.trainType}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {trip.trainNumber}
                      </Text>
                    </Stack>
                  </Group>

                  <Divider />

                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">
                      {trip.availableSeats} seats available
                    </Text>
                    <Group gap="md" align="center">
                      <Stack gap={0} align="flex-end">
                        <Text size="xl" fw={700} c="blue">
                          {trip.price}
                        </Text>
                        <Text size="xs" c="dimmed">
                          per passenger
                        </Text>
                      </Stack>
                      <ActionButton
                        rightSection={<IconArrowRight size={16} />}
                        onClick={() => handleSelectTrip(trip)}
                      >
                        Select
                      </ActionButton>
                    </Group>
                  </Group>
                </Flex>
              </Flex>
            </Card>
          ))}
        </Stack>
      </Container>
    </Flex>
  );
};

export default TripResults;
