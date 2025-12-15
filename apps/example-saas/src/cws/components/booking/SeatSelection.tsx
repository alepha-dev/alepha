import {
  useAction,
  useClient,
  useInject,
  useRouter,
  useStore,
} from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Divider,
  Group,
  Loader,
  Stack,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconArmchair, IconArrowRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { InventoryController } from "../../../api/inventory/controllers/InventoryController.ts";
import { bookingAtom, type Seat } from "../../atoms/bookingAtom.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { BookingService } from "../../services/BookingService.ts";

// Seat data type from API
interface ApiSeat {
  seatNumber: string;
  row: number;
  position: string; // A, B, C, D, E, etc. (flexible for different train types)
  seatClass: "first" | "second";
  seatType: "window" | "aisle" | "middle";
  status: "available" | "reserved" | "booked" | "blocked";
  seatPremium: number;
}

const SeatSelection = () => {
  const router = useRouter<CwsRouter>();
  const bookingService = useInject(BookingService);
  const inventoryClient = useClient<InventoryController>();
  const [booking] = useStore(bookingAtom);
  const [selectedSeatNumbers, setSelectedSeatNumbers] = useState<string[]>([]);
  const [apiSeats, setApiSeats] = useState<ApiSeat[]>([]);
  const [loading, setLoading] = useState(true);

  const requiredSeats = booking?.search?.passengers ?? 1;

  // Fetch seats from inventory controller
  useEffect(() => {
    const fetchSeats = async () => {
      if (!booking?.selectedTrip?.id || !booking?.tripInstanceId) {
        setLoading(false);
        return;
      }

      try {
        const seats = await inventoryClient.getSeats({
          params: { tripId: booking.selectedTrip.id },
          query: { tripInstanceId: booking.tripInstanceId },
        });
        setApiSeats(seats);
      } finally {
        setLoading(false);
      }
    };

    fetchSeats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.selectedTrip?.id, booking?.tripInstanceId]);

  // Convert API seats to display format
  const seats: Seat[] = apiSeats.map((s) => ({
    seatNumber: s.seatNumber,
    row: s.row,
    number: s.seatNumber,
    type: s.seatType === "window" ? "window" : "aisle",
    class: s.seatClass,
    price: s.seatPremium,
    isAvailable: s.status === "available",
  }));

  const toggleSeat = (seat: Seat) => {
    if (!seat.isAvailable) return;

    setSelectedSeatNumbers((prev) => {
      const isSelected = prev.includes(seat.seatNumber);
      if (isSelected) {
        return prev.filter((num) => num !== seat.seatNumber);
      }
      if (prev.length >= requiredSeats) {
        return [...prev.slice(1), seat.seatNumber];
      }
      return [...prev, seat.seatNumber];
    });
  };

  const selectedSeats = seats.filter((s) =>
    selectedSeatNumbers.includes(s.seatNumber),
  );

  const continueAction = useAction(
    {
      handler: async () => {
        if (!booking?.selectedTrip || !booking?.tripInstanceId) {
          throw new Error("Missing trip data");
        }

        // Reserve the seats via API
        const reservation = await inventoryClient.reserveSeats({
          params: { tripId: booking.selectedTrip.id },
          body: {
            tripInstanceId: booking.tripInstanceId,
            seatNumbers: selectedSeatNumbers,
            sessionId: crypto.randomUUID(),
            durationMinutes: 10,
          },
        });

        // Store reservation in booking state
        bookingService.setSeatReservation(
          {
            seatNumbers: reservation.seatNumbers,
            reservedUntil: reservation.reservedUntil,
          },
          selectedSeats,
        );

        bookingService.updateBooking({
          step: "addons",
        });

        await router.go("bookingAddOns");
      },
    },
    [
      booking?.selectedTrip,
      booking?.tripInstanceId,
      selectedSeatNumbers,
      selectedSeats,
    ],
  );

  const reserving = continueAction.loading;
  const handleContinue = continueAction.run;

  const handleReservationExpired = () => {
    // Clear selection when reservation expires
    setSelectedSeatNumbers([]);
  };

  const totalSeatPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0);
  const fareClassPrice =
    booking?.selectedFareClass?.price ?? booking?.selectedTrip?.price ?? 0;
  const basePrice = fareClassPrice * requiredSeats;
  const totalPrice = basePrice + totalSeatPrice;

  if (loading) {
    return (
      <Card
        withBorder
        p="xl"
        ta="center"
        bg="var(--alepha-elevated)"
        bd="1px solid var(--alepha-border)"
      >
        <Stack gap="md" align="center">
          <Loader size="lg" />
          <Text c="dimmed">Loading seats...</Text>
        </Stack>
      </Card>
    );
  }

  if (!booking?.selectedTrip) {
    return (
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
    );
  }

  const rows = [...new Set(seats.map((s) => s.row))].sort((a, b) => a - b);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={3}>Select Your Seats</Title>
        <Badge variant="light" color="pink" size="lg">
          {selectedSeats.length} / {requiredSeats} selected
        </Badge>
      </Group>

      <Card
        withBorder
        radius="md"
        p="md"
        bg="var(--alepha-elevated)"
        bd="1px solid var(--alepha-border)"
      >
        <Stack gap="md">
          {/* Legend */}
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

          {/* Seat map */}
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
                        (s) => s.seatNumber === seat.seatNumber,
                      );
                      return (
                        <Tooltip
                          key={seat.seatNumber}
                          label={
                            seat.isAvailable
                              ? `Seat ${seat.number} - ${seat.type} (${seat.class === "first" ? `+$${seat.price}` : "Free"})`
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
                        (s) => s.seatNumber === seat.seatNumber,
                      );
                      return (
                        <Tooltip
                          key={seat.seatNumber}
                          label={
                            seat.isAvailable
                              ? `Seat ${seat.number} - ${seat.type} (${seat.class === "first" ? `+$${seat.price}` : "Free"})`
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

      {/* Continue button */}
      <ActionButton
        variant="filled"
        color="pink"
        size="lg"
        rightSection={
          reserving ? (
            <Loader size={18} color="white" />
          ) : (
            <IconArrowRight size={18} />
          )
        }
        onClick={handleContinue}
        disabled={selectedSeats.length !== requiredSeats || reserving}
      >
        {reserving
          ? "Reserving..."
          : selectedSeats.length === requiredSeats
            ? "Continue to Add-ons"
            : `Select ${requiredSeats - selectedSeats.length} more seat${requiredSeats - selectedSeats.length > 1 ? "s" : ""}`}
      </ActionButton>
    </Stack>
  );
};

export default SeatSelection;
