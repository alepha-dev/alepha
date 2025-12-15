import { useInject, useRouter, useStore } from "@alepha/react";
import { ActionButton, Text } from "@alepha/ui";
import { Alert, Group, Progress, Stack } from "@mantine/core";
import { IconAlertTriangle, IconClock } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { bookingAtom } from "../../atoms/bookingAtom.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { BookingService } from "../../services/BookingService.ts";

interface ReservationTimerProps {
  onExpired?: () => void;
  compact?: boolean;
}

export const ReservationTimer = ({
  onExpired,
  compact,
}: ReservationTimerProps) => {
  const router = useRouter<CwsRouter>();
  const bookingService = useInject(BookingService);
  const [booking] = useStore(bookingAtom);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [isExpired, setIsExpired] = useState(false);

  // Total reservation time in seconds (10 minutes)
  const totalSeconds = 10 * 60;

  useEffect(() => {
    if (!booking?.seatReservation?.reservedUntil) {
      return;
    }

    const updateTimer = () => {
      const remaining = bookingService.getReservationTimeRemaining();
      setSecondsRemaining(remaining);

      if (remaining <= 0 && !isExpired) {
        setIsExpired(true);
        onExpired?.();
      }
    };

    // Initial update
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [booking?.seatReservation?.reservedUntil, isExpired, onExpired]);

  // No reservation, no timer
  if (!booking?.seatReservation?.reservedUntil) {
    return null;
  }

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const progress = (secondsRemaining / totalSeconds) * 100;
  const isWarning = secondsRemaining < 120; // Less than 2 minutes
  const isCritical = secondsRemaining < 60; // Less than 1 minute

  // Compact mode for sidebar
  if (compact) {
    if (isExpired) {
      return (
        <Group gap="xs" c="red">
          <IconAlertTriangle size={14} />
          <Text size="xs" fw={500}>
            Reservation expired
          </Text>
        </Group>
      );
    }

    return (
      <Stack gap={4}>
        <Group justify="space-between">
          <Group gap="xs">
            <IconClock
              size={14}
              color={
                isCritical
                  ? "var(--mantine-color-red-6)"
                  : isWarning
                    ? "var(--mantine-color-orange-6)"
                    : "var(--mantine-color-blue-6)"
              }
            />
            <Text size="xs" fw={500}>
              Seats reserved
            </Text>
          </Group>
          <Text
            size="xs"
            fw={700}
            c={isCritical ? "red" : isWarning ? "orange" : "blue"}
          >
            {minutes}:{seconds.toString().padStart(2, "0")}
          </Text>
        </Group>
        <Progress
          value={progress}
          color={isCritical ? "red" : isWarning ? "orange" : "blue"}
          size={4}
          animated={isWarning}
        />
      </Stack>
    );
  }

  if (isExpired) {
    return (
      <Alert
        icon={<IconAlertTriangle size={18} />}
        color="red"
        title="Reservation Expired"
        variant="light"
      >
        <Stack gap="sm">
          <Text size="sm">
            Your seat reservation has expired. Please select your seats again.
          </Text>
          <ActionButton
            size="sm"
            color="red"
            variant="light"
            onClick={async () => {
              bookingService.clearSeatReservation();
              await router.go("bookingSeats");
            }}
          >
            Select New Seats
          </ActionButton>
        </Stack>
      </Alert>
    );
  }

  return (
    <Alert
      icon={<IconClock size={18} />}
      color={isCritical ? "red" : isWarning ? "orange" : "blue"}
      variant="light"
      title="Seat Reservation"
    >
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm">
            Your seats are reserved for{" "}
            <Text component="span" fw={700}>
              {minutes}:{seconds.toString().padStart(2, "0")}
            </Text>
          </Text>
        </Group>
        <Progress
          value={progress}
          color={isCritical ? "red" : isWarning ? "orange" : "blue"}
          size="sm"
          animated={isWarning}
        />
        {isWarning && (
          <Text size="xs" c="dimmed">
            Complete your booking soon to secure your seats.
          </Text>
        )}
      </Stack>
    </Alert>
  );
};

export default ReservationTimer;
