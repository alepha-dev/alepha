import { useInject, useRouter } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Divider, Group, Stack, Title } from "@mantine/core";
import { MiniCalendar } from "@mantine/dates";
import {
  IconArrowRight,
  IconClock,
  IconTrain,
  IconTrendingUp,
} from "@tabler/icons-react";
import type { Trip } from "../../atoms/bookingAtom.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { BookingService } from "../../services/BookingService.ts";

/**
 * Props passed from $page resolve (SSR data fetching)
 */
export interface TripResultsProps {
  trips: Array<
    Trip & { priceRange?: { lowest: number; highest: number } | null }
  >;
  search: {
    from: string;
    to: string;
    date: string;
    passengers: number;
  };
}

const TripResults = (props: TripResultsProps) => {
  const { trips, search } = props;
  const router = useRouter<CwsRouter>();
  const bookingService = useInject(BookingService);

  const handleSelectTrip = async (
    trip: Trip & { priceRange?: { lowest: number; highest: number } | null },
  ) => {
    bookingService.updateBooking({
      step: "fareclass",
      selectedTrip: trip,
      search,
      // Clear any previous yield management state
      tripInstanceId: undefined,
      selectedFareClass: undefined,
      seatReservation: undefined,
      lockedPrice: undefined,
      priceValidUntil: undefined,
      dynamicMultiplier: undefined,
      selectedSeats: [],
    });
    await router.go("bookingFareClass", {
      query: {
        tripId: trip.id,
        date: search.date,
      },
    });
  };

  const handleDateChange = async (newDate: string | null) => {
    if (newDate && newDate !== search.date) {
      await router.go("bookingResults", {
        force: true,
        query: {
          from: search.from,
          to: search.to,
          date: newDate,
          passengers: String(search.passengers),
        },
      });
    }
  };

  return (
    <Stack gap="lg">
      {/* Date selector */}
      <Card
        withBorder
        radius="md"
        p="md"
        bg="var(--alepha-elevated)"
        bd="1px solid var(--alepha-border)"
      >
        <Flex justify="center">
          <MiniCalendar
            value={search.date}
            onChange={handleDateChange}
            numberOfDays={7}
            minDate={new Date().toISOString().split("T")[0]}
          />
        </Flex>
      </Card>

      {/* Results header */}
      <Group justify="space-between" align="center">
        <Title order={3}>{trips.length} trains available</Title>
        <Text c="dimmed" size="sm">
          Prices shown are per passenger
        </Text>
      </Group>

      {trips.map((trip) => (
        <Card
          key={trip.id}
          withBorder
          radius="md"
          p={0}
          bg="var(--alepha-elevated)"
          bd="1px solid var(--alepha-border)"
        >
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
                      <Divider w={60} color="var(--alepha-border)" />
                      <Flex
                        align="center"
                        gap={4}
                        c="dimmed"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        <IconClock size={14} />
                        <Text size="xs">{trip.duration}</Text>
                      </Flex>
                      <Divider w={60} color="var(--alepha-border)" />
                    </Group>
                    <Badge variant="light" size="sm" color="dark">
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

              <Divider color="var(--alepha-border)" />

              <Group justify="space-between" align="center">
                <Group gap="md">
                  <Text size="sm" c="dimmed">
                    {trip.availableSeats} seats available
                  </Text>
                  {trip.priceRange &&
                    trip.priceRange.lowest !== trip.priceRange.highest && (
                      <Badge
                        variant="light"
                        color="green"
                        size="sm"
                        leftSection={<IconTrendingUp size={12} />}
                      >
                        Multiple fares
                      </Badge>
                    )}
                </Group>
                <Group gap="md" align="center">
                  <Stack gap={0} align="flex-end">
                    {trip.priceRange ? (
                      <>
                        <Group gap={4} align="baseline">
                          <Text size="sm" c="dimmed">
                            From
                          </Text>
                          <Text size="xl" fw={700}>
                            ${trip.priceRange.lowest} CAD
                          </Text>
                        </Group>
                        {trip.priceRange.lowest !== trip.priceRange.highest && (
                          <Text size="xs" c="dimmed">
                            up to ${trip.priceRange.highest} CAD
                          </Text>
                        )}
                      </>
                    ) : (
                      <>
                        <Text size="xl" fw={700}>
                          ${trip.price} CAD
                        </Text>
                        <Text size="xs" c="dimmed">
                          per passenger
                        </Text>
                      </>
                    )}
                  </Stack>
                  <ActionButton
                    color="pink"
                    variant="filled"
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
  );
};

export default TripResults;
