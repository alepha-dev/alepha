import { useInject, useRouter, useStore } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArmchair,
  IconArrowLeft,
  IconArrowRight,
  IconTrain,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { BookingService } from "../../../api/services/BookingService.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { bookingAtom, type Seat } from "../../atoms/bookingAtom.ts";

const SeatSelection = () => {
  const router = useRouter<AppRouter>();
  const bookingService = useInject(BookingService);
  const [booking] = useStore(bookingAtom);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);

  const seats = useMemo(() => {
    if (!booking?.selectedTrip) return [];
    return bookingService.generateSeats(booking.selectedTrip.trainType);
  }, [booking?.selectedTrip]);

  const requiredSeats = booking?.search?.passengers ?? 1;

  const toggleSeat = (seat: Seat) => {
    if (!seat.isAvailable) return;

    setSelectedSeats((prev) => {
      const isSelected = prev.some((s) => s.id === seat.id);
      if (isSelected) {
        return prev.filter((s) => s.id !== seat.id);
      }
      if (prev.length >= requiredSeats) {
        return [...prev.slice(1), seat];
      }
      return [...prev, seat];
    });
  };

  const handleContinue = async () => {
    bookingService.updateBooking({
      step: "payment",
      selectedSeats,
    });
    await router.go("bookingPayment");
  };

  const totalSeatPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0);
  const basePrice = (booking?.selectedTrip?.price ?? 0) * requiredSeats;
  const totalPrice = basePrice + totalSeatPrice;

  if (!booking?.selectedTrip) {
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
            <Text c="dimmed">No trip selected</Text>
            <ActionButton href={router.path("bookingSearch")}>
              Start New Search
            </ActionButton>
          </Stack>
        </Card>
      </Container>
    );
  }

  const rows = [...new Set(seats.map((s) => s.row))].sort((a, b) => a - b);

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
                href={router.path("bookingResults", {
                  query: {
                    from: booking.search?.from ?? "",
                    to: booking.search?.to ?? "",
                    date: booking.search?.date ?? "",
                    passengers: String(booking.search?.passengers ?? 1),
                  },
                })}
              >
                Back
              </ActionButton>
              <Divider orientation="vertical" color="dark.5" />
              <Group gap="xs">
                <IconTrain size={18} color="white" />
                <Text c="white" fw={600}>
                  {booking.selectedTrip.trainNumber}
                </Text>
                <Text c="dark.3">
                  {booking.selectedTrip.departureTime} -{" "}
                  {booking.selectedTrip.arrivalTime}
                </Text>
              </Group>
            </Group>
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
              Select {requiredSeats} seat{requiredSeats > 1 ? "s" : ""}
            </Badge>
          </Group>
        </Container>
      </Box>

      <Container size="lg" py="xl">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="lg">
            <Title order={3}>Select Your Seats</Title>

            <Card
              withBorder
              radius="md"
              p="md"
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
            >
              <Stack gap="md">
                <Group justify="center" gap="lg">
                  <Group gap="xs">
                    <Box
                      w={24}
                      h={24}
                      bg="var(--alepha-surface)"
                      style={{ borderRadius: 4 }}
                    />
                    <Text size="sm">Available</Text>
                  </Group>
                  <Group gap="xs">
                    <Box
                      w={24}
                      h={24}
                      bg="var(--mantine-color-pink-6)"
                      style={{ borderRadius: 4 }}
                    />
                    <Text size="sm">Selected</Text>
                  </Group>
                  <Group gap="xs">
                    <Box
                      w={24}
                      h={24}
                      bg="var(--mantine-color-gray-4)"
                      style={{ borderRadius: 4 }}
                    />
                    <Text size="sm">Occupied</Text>
                  </Group>
                </Group>

                <Divider color="var(--alepha-border)" />

                <Flex direction="column" align="center" gap="sm">
                  <Badge variant="light" color="dark" mb="md">
                    Front of Train
                  </Badge>

                  {rows.map((row) => {
                    const rowSeats = seats.filter((s) => s.row === row);
                    const isFirstClass = row <= 3;

                    return (
                      <Flex key={row} gap="md" align="center">
                        {isFirstClass && row === 1 && (
                          <Badge
                            variant="light"
                            color="yellow"
                            size="xs"
                            pos="absolute"
                            left={-80}
                          >
                            1st Class
                          </Badge>
                        )}
                        {!isFirstClass && row === 4 && (
                          <Badge
                            variant="light"
                            color="gray"
                            size="xs"
                            pos="absolute"
                            left={-80}
                          >
                            2nd Class
                          </Badge>
                        )}

                        <Text size="xs" c="dimmed" w={20} ta="right">
                          {row}
                        </Text>

                        <Group gap="xs">
                          {rowSeats.slice(0, 2).map((seat) => {
                            const isSelected = selectedSeats.some(
                              (s) => s.id === seat.id,
                            );
                            return (
                              <Tooltip
                                key={seat.id}
                                label={
                                  seat.isAvailable
                                    ? `Seat ${seat.number} - ${seat.type} (${seat.class === "first" ? "+$" + seat.price : "Free"})`
                                    : "Occupied"
                                }
                              >
                                <UnstyledButton
                                  onClick={() => toggleSeat(seat)}
                                  disabled={!seat.isAvailable}
                                  style={{
                                    cursor: seat.isAvailable
                                      ? "pointer"
                                      : "not-allowed",
                                  }}
                                >
                                  <Flex
                                    w={40}
                                    h={40}
                                    justify="center"
                                    align="center"
                                    bg={
                                      isSelected
                                        ? "var(--mantine-color-pink-6)"
                                        : seat.isAvailable
                                          ? isFirstClass
                                            ? "var(--mantine-color-yellow-1)"
                                            : "var(--alepha-surface)"
                                          : "var(--mantine-color-gray-4)"
                                    }
                                    c={isSelected ? "white" : "dark"}
                                    style={{
                                      borderRadius: 6,
                                      border: isFirstClass
                                        ? "2px solid var(--mantine-color-yellow-4)"
                                        : undefined,
                                    }}
                                  >
                                    <IconArmchair size={20} />
                                  </Flex>
                                </UnstyledButton>
                              </Tooltip>
                            );
                          })}
                        </Group>

                        <Box w={40} />

                        <Group gap="xs">
                          {rowSeats.slice(2, 4).map((seat) => {
                            const isSelected = selectedSeats.some(
                              (s) => s.id === seat.id,
                            );
                            return (
                              <Tooltip
                                key={seat.id}
                                label={
                                  seat.isAvailable
                                    ? `Seat ${seat.number} - ${seat.type} (${seat.class === "first" ? "+$" + seat.price : "Free"})`
                                    : "Occupied"
                                }
                              >
                                <UnstyledButton
                                  onClick={() => toggleSeat(seat)}
                                  disabled={!seat.isAvailable}
                                  style={{
                                    cursor: seat.isAvailable
                                      ? "pointer"
                                      : "not-allowed",
                                  }}
                                >
                                  <Flex
                                    w={40}
                                    h={40}
                                    justify="center"
                                    align="center"
                                    bg={
                                      isSelected
                                        ? "var(--mantine-color-pink-6)"
                                        : seat.isAvailable
                                          ? isFirstClass
                                            ? "var(--mantine-color-yellow-1)"
                                            : "var(--alepha-surface)"
                                          : "var(--mantine-color-gray-4)"
                                    }
                                    c={isSelected ? "white" : "dark"}
                                    style={{
                                      borderRadius: 6,
                                      border: isFirstClass
                                        ? "2px solid var(--mantine-color-yellow-4)"
                                        : undefined,
                                    }}
                                  >
                                    <IconArmchair size={20} />
                                  </Flex>
                                </UnstyledButton>
                              </Tooltip>
                            );
                          })}
                        </Group>

                        <Text size="xs" c="dimmed" w={20}>
                          {row}
                        </Text>
                      </Flex>
                    );
                  })}

                  <Badge variant="light" color="dark" mt="md">
                    Rear of Train
                  </Badge>
                </Flex>
              </Stack>
            </Card>
          </Stack>

          <Stack gap="lg">
            <Title order={3}>Booking Summary</Title>

            <Card
              withBorder
              radius="md"
              p="lg"
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
            >
              <Stack gap="md">
                <Group justify="space-between">
                  <Text c="dimmed">Route</Text>
                  <Text fw={500}>
                    {booking.search?.from} → {booking.search?.to}
                  </Text>
                </Group>

                <Group justify="space-between">
                  <Text c="dimmed">Train</Text>
                  <Text fw={500}>{booking.selectedTrip.trainNumber}</Text>
                </Group>

                <Group justify="space-between">
                  <Text c="dimmed">Time</Text>
                  <Text fw={500}>
                    {booking.selectedTrip.departureTime} -{" "}
                    {booking.selectedTrip.arrivalTime}
                  </Text>
                </Group>

                <Divider color="var(--alepha-border)" />

                <Group justify="space-between">
                  <Text c="dimmed">
                    Base fare ({requiredSeats} × ${booking.selectedTrip.price})
                  </Text>
                  <Text fw={500}>${basePrice} CAD</Text>
                </Group>

                {selectedSeats.length > 0 && (
                  <>
                    <Text size="sm" fw={500}>
                      Selected Seats:
                    </Text>
                    {selectedSeats.map((seat) => (
                      <Group key={seat.id} justify="space-between">
                        <Text size="sm" c="dimmed">
                          Seat {seat.number} ({seat.class} class, {seat.type})
                        </Text>
                        <Text size="sm">
                          {seat.price > 0 ? `+$${seat.price}` : "Free"}
                        </Text>
                      </Group>
                    ))}
                  </>
                )}

                <Divider color="var(--alepha-border)" />

                <Group justify="space-between">
                  <Text fw={600} size="lg">
                    Total
                  </Text>
                  <Text fw={700} size="xl">
                    ${totalPrice} CAD
                  </Text>
                </Group>

                <ActionButton
                  variant="filled"
                  color="pink"
                  size="lg"
                  rightSection={<IconArrowRight size={18} />}
                  onClick={handleContinue}
                  disabled={selectedSeats.length !== requiredSeats}
                >
                  {selectedSeats.length === requiredSeats
                    ? "Continue to Payment"
                    : `Select ${requiredSeats - selectedSeats.length} more seat${requiredSeats - selectedSeats.length > 1 ? "s" : ""}`}
                </ActionButton>
              </Stack>
            </Card>
          </Stack>
        </SimpleGrid>
      </Container>
    </Flex>
  );
};

export default SeatSelection;
