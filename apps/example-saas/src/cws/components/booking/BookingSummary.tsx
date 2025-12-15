import { useStore } from "@alepha/react";
import { Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Collapse,
  Divider,
  Group,
  Progress,
  Stack,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArmchair,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconGift,
  IconShieldCheck,
  IconTicket,
  IconTrain,
} from "@tabler/icons-react";
import { bookingAtom } from "../../atoms/bookingAtom.ts";
import { ReservationTimer } from "./ReservationTimer.tsx";

/**
 * BookingSummary - Persistent sidebar showing booking progress and details
 */
export const BookingSummary = () => {
  const [booking] = useStore(bookingAtom);
  const [seatsExpanded, seatsHandlers] = useDisclosure(false);
  const [addOnsExpanded, addOnsHandlers] = useDisclosure(false);

  if (!booking?.selectedTrip) {
    return null;
  }

  const requiredSeats = booking.search?.passengers ?? 1;
  const fareClassPrice =
    booking.selectedFareClass?.price ?? booking.selectedTrip.price ?? 0;
  const basePrice = fareClassPrice * requiredSeats;
  const seatPrice =
    booking.selectedSeats?.reduce((sum, s) => sum + s.price, 0) ?? 0;
  const addOnsTotal = booking.addOnsTotal ?? 0;
  const totalPrice = basePrice + seatPrice + addOnsTotal * 100; // addOnsTotal is in dollars, convert to cents

  // Calculate booking progress
  const steps = [
    !!booking.selectedTrip, // Trip selected
    !!booking.selectedFareClass, // Fare class selected
    (booking.selectedSeats?.length ?? 0) >= requiredSeats, // Seats selected
    true, // Add-ons is optional, always "done"
  ];
  const completedSteps = steps.filter(Boolean).length;
  const progressPercent = (completedSteps / 4) * 100;

  return (
    <Card
      withBorder
      radius="md"
      p={0}
      bg="var(--alepha-elevated)"
      bd="1px solid var(--alepha-border)"
      style={{ overflow: "hidden" }}
    >
      {/* Header */}
      <Group
        p="md"
        justify="space-between"
        bg="dark.9"
        style={{ borderBottom: "1px solid var(--alepha-border)" }}
      >
        <Group gap="xs">
          <ThemeIcon size="sm" variant="light" color="pink">
            <IconTicket size={14} />
          </ThemeIcon>
          <Text c="white" fw={600} size="sm">
            Your Booking
          </Text>
        </Group>
        <Text c="dark.3" size="xs">
          {Math.round(progressPercent)}% complete
        </Text>
      </Group>

      <Progress
        value={progressPercent}
        size="xs"
        color="pink"
        radius={0}
        style={{ borderRadius: 0 }}
      />

      <Stack gap={0} p="md">
        {/* Reservation Timer */}
        {booking.seatReservation && (
          <>
            <ReservationTimer compact />
            <Divider my="sm" color="var(--alepha-border)" />
          </>
        )}

        {/* Journey Details */}
        <Group justify="space-between" mb="xs">
          <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
            Journey
          </Text>
          <Badge size="xs" variant="light" color="dark">
            {booking.selectedTrip.trainType}
          </Badge>
        </Group>

        <Group gap="md" mb="sm">
          <Stack gap={2}>
            <Text size="lg" fw={700}>
              {booking.selectedTrip.departureTime}
            </Text>
            <Text size="xs" c="dimmed">
              {booking.search?.from}
            </Text>
          </Stack>

          <Stack gap={0} align="center" style={{ flex: 1 }}>
            <Divider w="100%" color="var(--alepha-border)" />
            <Group gap={4} my={4}>
              <IconClock size={12} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">
                {booking.selectedTrip.duration}
              </Text>
            </Group>
            <Divider w="100%" color="var(--alepha-border)" />
          </Stack>

          <Stack gap={2} align="flex-end">
            <Text size="lg" fw={700}>
              {booking.selectedTrip.arrivalTime}
            </Text>
            <Text size="xs" c="dimmed">
              {booking.search?.to}
            </Text>
          </Stack>
        </Group>

        <Group gap="xs" mb="md">
          <IconTrain size={14} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed">
            {booking.selectedTrip.trainNumber}
          </Text>
          <Text size="sm" c="dimmed">
            •
          </Text>
          <Text size="sm" c="dimmed">
            {booking.search?.date}
          </Text>
        </Group>

        <Divider mb="md" color="var(--alepha-border)" />

        {/* Pricing Breakdown */}
        <Stack gap="xs">
          {/* Fare Class */}
          {booking.selectedFareClass ? (
            <Group justify="space-between">
              <Group gap="xs">
                <IconTicket size={14} color="var(--mantine-color-pink-6)" />
                <Text size="sm">
                  {booking.selectedFareClass.name} × {requiredSeats}
                </Text>
              </Group>
              <Text size="sm" fw={500}>
                ${basePrice.toFixed(2)}
              </Text>
            </Group>
          ) : (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Fare class
              </Text>
              <Badge size="xs" variant="light" color="gray">
                Not selected
              </Badge>
            </Group>
          )}

          {/* Seats */}
          {(booking.selectedSeats?.length ?? 0) > 0 ? (
            <>
              <UnstyledButton onClick={seatsHandlers.toggle} w="100%">
                <Group justify="space-between">
                  <Group gap="xs">
                    <IconArmchair
                      size={14}
                      color="var(--mantine-color-blue-6)"
                    />
                    <Text size="sm">
                      Seats ({booking.selectedSeats?.length})
                    </Text>
                    {seatsExpanded ? (
                      <IconChevronUp size={12} />
                    ) : (
                      <IconChevronDown size={12} />
                    )}
                  </Group>
                  <Text size="sm" fw={500}>
                    {seatPrice > 0 ? `+$${(seatPrice).toFixed(2)}` : "Included"}
                  </Text>
                </Group>
              </UnstyledButton>
              <Collapse in={seatsExpanded}>
                <Stack gap={4} pl="xl">
                  {booking.selectedSeats?.map((seat) => (
                    <Group key={seat.seatNumber} justify="space-between">
                      <Text size="xs" c="dimmed">
                        Seat {seat.number} ({seat.class})
                      </Text>
                      <Text size="xs" c="dimmed">
                        {seat.price > 0 ? `+$${(seat.price).toFixed(2)}` : "—"}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Collapse>
            </>
          ) : (
            <Group justify="space-between">
              <Group gap="xs">
                <IconArmchair size={14} color="var(--mantine-color-dimmed)" />
                <Text size="sm" c="dimmed">
                  Seats
                </Text>
              </Group>
              <Badge size="xs" variant="light" color="gray">
                Not selected
              </Badge>
            </Group>
          )}

          {/* Add-ons */}
          {booking.selectedAddOns && booking.selectedAddOns.length > 0 ? (
            <>
              <UnstyledButton onClick={addOnsHandlers.toggle} w="100%">
                <Group justify="space-between">
                  <Group gap="xs">
                    <IconGift size={14} color="var(--mantine-color-grape-6)" />
                    <Text size="sm">
                      Add-ons ({booking.selectedAddOns.length})
                    </Text>
                    {addOnsExpanded ? (
                      <IconChevronUp size={12} />
                    ) : (
                      <IconChevronDown size={12} />
                    )}
                  </Group>
                  <Text size="sm" fw={500}>
                    +${addOnsTotal.toFixed(2)}
                  </Text>
                </Group>
              </UnstyledButton>
              <Collapse in={addOnsExpanded}>
                <Stack gap={4} pl="xl">
                  {booking.selectedAddOns.map((addOn) => (
                    <Group key={addOn.productId} justify="space-between">
                      <Text size="xs" c="dimmed">
                        {addOn.productName} × {addOn.quantity}
                      </Text>
                      <Text size="xs" c="dimmed">
                        ${addOn.total.toFixed(2)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Collapse>
            </>
          ) : (
            <Group justify="space-between">
              <Group gap="xs">
                <IconGift size={14} color="var(--mantine-color-dimmed)" />
                <Text size="sm" c="dimmed">
                  Add-ons
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Optional
              </Text>
            </Group>
          )}
        </Stack>

        <Divider my="md" color="var(--alepha-border)" />

        {/* Total */}
        <Group justify="space-between">
          <Text fw={600}>Total</Text>
          <Text size="xl" fw={700} c="pink">
            ${totalPrice.toFixed(2)}
          </Text>
        </Group>

        {/* Fare benefits */}
        {booking.selectedFareClass && (
          <>
            <Divider my="md" color="var(--alepha-border)" />
            <Group gap="xs">
              <IconShieldCheck
                size={16}
                color={
                  booking.selectedFareClass.isRefundable
                    ? "var(--mantine-color-green-6)"
                    : "var(--mantine-color-gray-6)"
                }
              />
              <Stack gap={0}>
                <Text size="xs" fw={500}>
                  {booking.selectedFareClass.isRefundable
                    ? booking.selectedFareClass.refundFeePercent > 0
                      ? `Refundable (${booking.selectedFareClass.refundFeePercent}% fee)`
                      : "Fully refundable"
                    : "Non-refundable"}
                </Text>
                <Text size="xs" c="dimmed">
                  {booking.selectedFareClass.isChangeable
                    ? booking.selectedFareClass.changeFeePercent > 0
                      ? `Changes: ${booking.selectedFareClass.changeFeePercent}% fee`
                      : "Free changes"
                    : "No changes allowed"}
                </Text>
              </Stack>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
};
