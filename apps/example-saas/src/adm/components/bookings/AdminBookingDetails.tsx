import { useClient, useRouter, useRouterState } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Control, Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { t } from "alepha";
import { useEffect, useState } from "react";
import type { BookingController } from "../../../api/bookings/controllers/BookingController.ts";
import type { Booking } from "../../../api/bookings/entities/bookings.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const AdminBookingDetails = () => {
  const state = useRouterState();
  const router = useRouter<AdmRouter>();
  const client = useClient<BookingController>();
  const { l } = useI18n();
  const bookingId = state.params.bookingId as string;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const loadBooking = async () => {
      try {
        const data = await client.getBooking({
          params: { id: bookingId },
        });
        setBooking(data);
      } finally {
        setLoading(false);
      }
    };

    loadBooking();
  }, [bookingId]);

  const form = useForm({
    schema: t.object({
      passengerFirstName: t.optional(t.text()),
      passengerLastName: t.optional(t.text()),
      passengerEmail: t.optional(t.email()),
      status: t.optional(t.enum(["pending", "confirmed", "cancelled"])),
    }),
    handler: async (data) => {
      const updated = await client.updateBooking({
        params: { id: bookingId },
        body: data,
      });
      setBooking(updated);
    },
  });

  useEffect(() => {
    if (booking) {
      form.input.passengerFirstName?.set(booking.passengerFirstName ?? "");
      form.input.passengerLastName?.set(booking.passengerLastName ?? "");
      form.input.passengerEmail?.set(booking.passengerEmail ?? "");
      form.input.status?.set(booking.status);
    }
  }, [booking]);

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel this booking?")) {
      return;
    }
    setCancelling(true);
    try {
      await client.cancelBooking({
        params: { id: bookingId },
      });
      const updated = await client.getBooking({
        params: { id: bookingId },
      });
      setBooking(updated);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!booking) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Booking not found</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md">
      <Card withBorder p="lg">
        <Stack gap="md">
          <Text size="lg" fw={500}>
            Trip Details
          </Text>

          <Group gap="xl" wrap="wrap">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Booking ID
              </Text>
              <Text size="sm" ff="monospace">
                {booking.id}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Train
              </Text>
              <Text size="sm">
                {booking.trainNumber} ({booking.trainType})
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Departure
              </Text>
              <Text size="sm">
                {booking.departureStation} at {booking.departureTime}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Arrival
              </Text>
              <Text size="sm">
                {booking.arrivalStation} at {booking.arrivalTime}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Travel Date
              </Text>
              <Text size="sm">{booking.travelDate}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Passengers
              </Text>
              <Text size="sm">{booking.passengerCount}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Seats
              </Text>
              <Group gap={4}>
                {booking.seats.map((seat) => (
                  <Badge key={seat.number} size="sm" variant="outline">
                    {seat.number} ({seat.class})
                  </Badge>
                ))}
              </Group>
            </Stack>
          </Group>
        </Stack>
      </Card>

      <Card withBorder p="lg">
        <Stack gap="md">
          <Text size="lg" fw={500}>
            Pricing
          </Text>

          <Group gap="xl">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Base Fare
              </Text>
              <Text size="sm">${booking.baseFare.toFixed(2)}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Seat Upgrades
              </Text>
              <Text size="sm">${booking.seatUpgrades.toFixed(2)}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Total Price
              </Text>
              <Text size="sm" fw={600}>
                ${booking.totalPrice.toFixed(2)}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Created
              </Text>
              <Text size="sm">{l(booking.createdAt, { date: "medium" })}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Updated
              </Text>
              <Text size="sm">{l(booking.updatedAt, { date: "medium" })}</Text>
            </Stack>
          </Group>
        </Stack>
      </Card>

      <Card withBorder p="lg">
        <form {...form.props}>
          <Stack gap="md">
            <Text size="lg" fw={500}>
              Edit Booking
            </Text>

            <Group grow>
              <Control
                title="First Name"
                input={form.input.passengerFirstName}
              />
              <Control title="Last Name" input={form.input.passengerLastName} />
            </Group>

            <Group grow>
              <Control title="Email" input={form.input.passengerEmail} />
              <Control title="Status" input={form.input.status} />
            </Group>

            <Group>
              <ActionButton form={form}>Save Changes</ActionButton>
              {booking.status !== "cancelled" && (
                <ActionButton
                  color="red"
                  variant="light"
                  leftSection={<IconTrash size={16} />}
                  onClick={handleCancel}
                  loading={cancelling}
                >
                  Cancel Booking
                </ActionButton>
              )}
            </Group>
          </Stack>
        </form>
      </Card>
    </Flex>
  );
};

export default AdminBookingDetails;
