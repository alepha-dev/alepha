import { useInject, useRouter } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Group,
  Stack,
  Title,
} from "@mantine/core";
import { MiniCalendar } from "@mantine/dates";
import {
  IconArrowLeft,
  IconArrowRight,
  IconClock,
  IconTrain,
  IconUsers,
} from "@tabler/icons-react";
import { BookingService } from "../../../api/services/BookingService.ts";
import type { AppRouter } from "../../AppRouter.ts";
import type { Trip } from "../../atoms/bookingAtom.ts";

/**
 * Props passed from $page resolve (SSR data fetching)
 */
export interface TripResultsProps {
  trips: Trip[];
  search: {
    from: string;
    to: string;
    date: string;
    passengers: number;
  };
}

const TripResults = (props: TripResultsProps) => {
  const { trips, search } = props;
  const router = useRouter<AppRouter>();
  const bookingService = useInject(BookingService);

  const handleSelectTrip = async (trip: Trip) => {
    bookingService.updateBooking({
      step: "seats",
      selectedTrip: trip,
      search,
    });
    await router.go("bookingSeats");
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
    <Flex flex={1} direction="column" bg="var(--alepha-background)">
      {/* Header with grid pattern */}
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
        <Container size="lg" py="lg" pos="relative">
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
              <Divider orientation="vertical" color="dark.5" />
              <Group gap="xs">
                <Text c="white" fw={600}>
                  {search.from}
                </Text>
                <IconArrowRight size={16} color="white" />
                <Text c="white" fw={600}>
                  {search.to}
                </Text>
              </Group>
            </Group>
            <Group gap="md">
              <Badge
                variant="outline"
                color="gray"
                size="lg"
                leftSection={<IconUsers size={14} />}
                styles={{
                  root: {
                    borderColor: "rgba(255,255,255,0.3)",
                    color: "white",
                  },
                }}
              >
                {search.passengers} passenger
                {search.passengers > 1 ? "s" : ""}
              </Badge>
              <Badge
                variant="outline"
                color="gray"
                size="lg"
                styles={{
                  root: {
                    borderColor: "rgba(255,255,255,0.3)",
                    color: "white",
                  },
                }}
              >
                {search.date}
              </Badge>
            </Group>
          </Group>
        </Container>
      </Box>

      <Container size="lg" py="xl">
        <Stack gap="md">
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
                    <Text size="sm" c="dimmed">
                      {trip.availableSeats} seats available
                    </Text>
                    <Group gap="md" align="center">
                      <Stack gap={0} align="flex-end">
                        <Text size="xl" fw={700}>
                          ${trip.price} CAD
                        </Text>
                        <Text size="xs" c="dimmed">
                          per passenger
                        </Text>
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
      </Container>
    </Flex>
  );
};

export default TripResults;
