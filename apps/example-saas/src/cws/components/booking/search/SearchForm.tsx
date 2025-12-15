import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconLeaf,
  IconMapPin,
  IconUsers,
} from "@tabler/icons-react";
import { dayjs } from "alepha/datetime";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { StationResource } from "../../../../api/topology/schemas/stationSchema.ts";
import type { CwsRouter } from "../../../CwsRouter.ts";

export interface SearchFormState {
  from: string | null;
  to: string | null;
  date: Date | null;
}

export interface SearchFormProps {
  stations: StationResource[];
  value: SearchFormState;
  onChange: (state: SearchFormState) => void;
}

export const SearchForm = (props: SearchFormProps) => {
  const { stations, value, onChange } = props;
  const router = useRouter<CwsRouter>();
  const [tripType, setTripType] = useState("one-way");
  const [passengers, setPassengers] = useState<number | string>(1);
  const [loading, setLoading] = useState(false);

  const stationOptions = useMemo(
    () => stations.map((s) => ({ value: s.name, label: s.name })),
    [stations],
  );

  const handleSearch = async () => {
    if (!value.from || !value.to || !value.date) return;

    setLoading(true);
    try {
      await router.go("bookingResults", {
        query: {
          from: value.from,
          to: value.to,
          date: value.date.toISOString().split("T")[0],
          passengers: String(passengers),
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const isValid =
    value.from && value.to && value.date && value.from !== value.to;

  return (
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
                value={value.from}
                onChange={(from) => onChange({ ...value, from })}
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
                value={value.to}
                onChange={(to) => onChange({ ...value, to })}
                searchable
                leftSection={<IconMapPin size={16} />}
                required
                size="md"
                radius="md"
              />
            </Group>

            <Group grow align="flex-start">
              <DatePickerInput
                label="Date"
                placeholder="Select date"
                value={value.date}
                onChange={(date) =>
                  onChange({ ...value, date: date ? new Date(date) : null })
                }
                minDate={new Date()}
                leftSection={<IconCalendar size={16} />}
                required
                size="md"
                radius="md"
                clearable
                presets={[
                  { value: dayjs().format("YYYY-MM-DD"), label: "Today" },
                  {
                    value: dayjs().add(1, "day").format("YYYY-MM-DD"),
                    label: "Tomorrow",
                  },
                  {
                    value: dayjs().add(1, "week").format("YYYY-MM-DD"),
                    label: "Next week",
                  },
                  {
                    value: dayjs().add(1, "month").format("YYYY-MM-DD"),
                    label: "Next month",
                  },
                ]}
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
  );
};
