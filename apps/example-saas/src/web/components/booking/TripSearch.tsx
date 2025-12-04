import { useRouter } from "@alepha/react";
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
import { useMemo, useState } from "react";
import type { StationResource } from "../../../api/schemas/stationSchema.ts";
import type { Trip } from "../../../api/schemas/tripSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";

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

  // Transform stations for Select component
  const stationOptions = useMemo(
    () => props.stations.map((s) => ({ value: s.name, label: s.name })),
    [props.stations],
  );

  const handleSearch = async () => {
    if (!from || !to || !date) return;

    setLoading(true);
    try {
      // Navigate with query params - resolve will fetch from API (SSR)
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
                data={stationOptions}
                value={from}
                onChange={setFrom}
                searchable
                leftSection={<IconMapPin size={16} />}
                required
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

      {props.popularRoutes.length > 0 && (
        <Container size="lg" py="xl">
          <Stack gap="lg">
            <Title order={3} ta="center">
              Popular Routes
            </Title>
            <Group justify="center" gap="md">
              {props.popularRoutes.map((route) => (
                <Card
                  key={route.id}
                  withBorder
                  radius="md"
                  p="md"
                  w={260}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setFrom(route.departureStation);
                    setTo(route.arrivalStation);
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setDate(tomorrow);
                  }}
                >
                  <Stack gap="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="sm" fw={600} lineClamp={1}>
                        {route.departureStation.split(" ")[0]}
                      </Text>
                      <IconArrowRight size={14} />
                      <Text size="sm" fw={600} lineClamp={1}>
                        {route.arrivalStation.split(" ")[0]}
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        {route.duration}
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
      )}
    </Flex>
  );
};

export default TripSearch;
