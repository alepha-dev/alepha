import { useInject, useRouter } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Card,
  Container,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconArrowRight,
  IconCalendar,
  IconMapPin,
  IconTrain,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import { BookingService } from "../../services/BookingService.ts";

const TripSearch = () => {
  const router = useRouter<AppRouter>();
  const bookingService = useInject(BookingService);
  const [tripType, setTripType] = useState("one-way");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [passengers, setPassengers] = useState<number | string>(1);
  const [loading, setLoading] = useState(false);

  const stations = bookingService.stations;

  const handleSearch = async () => {
    if (!from || !to || !date) return;

    setLoading(true);
    try {
      bookingService.updateBooking({
        step: "results",
        search: {
          from,
          to,
          date: date.toISOString().split("T")[0],
          passengers: Number(passengers),
        },
      });
      await router.go("bookingResults");
    } finally {
      setLoading(false);
    }
  };

  const isValid = from && to && date && from !== to;

  return (
    <Flex flex={1} direction="column">
      <Flex
        h={300}
        bg="linear-gradient(135deg, var(--mantine-color-blue-6) 0%, var(--mantine-color-indigo-7) 100%)"
        justify="center"
        align="center"
        direction="column"
        gap="md"
        p="xl"
      >
        <IconTrain size={64} color="white" stroke={1.5} />
        <Title order={1} c="white" ta="center">
          Book Your Train Journey
        </Title>
        <Text c="white" size="lg" ta="center" maw={500} opacity={0.9}>
          Fast, comfortable, and eco-friendly travel across Europe
        </Text>
      </Flex>

      <Container size="md" mt={-60}>
        <Card
          withBorder
          shadow="xl"
          radius="lg"
          p="xl"
          bg={"var(--mantine-color-body)"}
        >
          <Stack gap="lg">
            <Group justify="center">
              <SegmentedControl
                value={tripType}
                onChange={setTripType}
                data={[
                  { label: "One Way", value: "one-way" },
                  { label: "Round Trip", value: "round-trip" },
                ]}
              />
            </Group>

            <Group grow align="flex-start">
              <Select
                label="From"
                placeholder="Departure station"
                data={stations}
                value={from}
                onChange={setFrom}
                searchable
                leftSection={<IconMapPin size={16} />}
                required
              />
              <Select
                label="To"
                placeholder="Arrival station"
                data={stations}
                value={to}
                onChange={setTo}
                searchable
                leftSection={<IconMapPin size={16} />}
                required
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
              />
            </Group>

            <ActionButton
              color="pink"
              size="lg"
              rightSection={<IconArrowRight size={20} />}
              onClick={handleSearch}
              loading={loading}
              disabled={!isValid}
            >
              Search Trains
            </ActionButton>
          </Stack>
        </Card>
      </Container>

      <Container size="lg" py="xl">
        <Stack gap="lg">
          <Title order={3} ta="center">
            Popular Routes
          </Title>
          <Group justify="center" gap="md">
            {[
              {
                from: "Paris Gare du Nord",
                to: "London St Pancras",
                time: "2h 15min",
                price: 79,
              },
              {
                from: "Amsterdam Centraal",
                to: "Brussels Midi",
                time: "1h 50min",
                price: 49,
              },
              {
                from: "Frankfurt Hbf",
                to: "Cologne Hbf",
                time: "1h 05min",
                price: 39,
              },
              {
                from: "Lyon Part-Dieu",
                to: "Marseille Saint-Charles",
                time: "1h 40min",
                price: 45,
              },
            ].map((route) => (
              <Card
                key={`${route.from}-${route.to}`}
                withBorder
                radius="md"
                p="md"
                w={260}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setFrom(route.from);
                  setTo(route.to);
                }}
              >
                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={600} lineClamp={1}>
                      {route.from.split(" ")[0]}
                    </Text>
                    <IconArrowRight size={14} />
                    <Text size="sm" fw={600} lineClamp={1}>
                      {route.to.split(" ")[0]}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      {route.time}
                    </Text>
                    <Text size="sm" fw={600} c="blue">
                      From €{route.price}
                    </Text>
                  </Group>
                </Stack>
              </Card>
            ))}
          </Group>
        </Stack>
      </Container>
    </Flex>
  );
};

export default TripSearch;
