import {
  NestedView,
  useClient,
  useRouter,
  useRouterState,
} from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, Tabs } from "@mantine/core";
import { IconArrowRight, IconTicket, IconUser } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { BookingController } from "../../../api/controllers/BookingController.ts";
import type { Booking } from "../../../api/entities/bookings.ts";
import type { AppRouter } from "../../AppRouter.ts";

const statusColors: Record<string, string> = {
  pending: "yellow",
  confirmed: "green",
  cancelled: "red",
};

const AdminBookingLayout = () => {
  const router = useRouter<AppRouter>();
  const state = useRouterState();
  const client = useClient<BookingController>();
  const bookingId = state.params.bookingId as string;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);

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

  const currentPath = state.url.pathname;
  const detailsPath = router.path("adminBookingDetails", {
    params: { bookingId },
  });

  const getActiveTab = () => {
    return "details";
  };
  const activeTab = getActiveTab();

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group justify="space-between">
          <Group>
            <IconTicket size={32} color="var(--mantine-color-blue-6)" />
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="lg" fw={600} ff="monospace">
                  {booking.reference}
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={statusColors[booking.status] || "gray"}
                >
                  {booking.status.charAt(0).toUpperCase() +
                    booking.status.slice(1)}
                </Badge>
              </Group>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {booking.departureStation}
                </Text>
                <IconArrowRight size={14} color="var(--mantine-color-dimmed)" />
                <Text size="sm" c="dimmed">
                  {booking.arrivalStation}
                </Text>
                <Text size="sm" c="dimmed">
                  •
                </Text>
                <Text size="sm" c="dimmed">
                  {booking.travelDate}
                </Text>
              </Group>
            </Stack>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {booking.passengerFirstName} {booking.passengerLastName}
            </Text>
          </Group>
        </Group>
      </Card>

      <Tabs value={activeTab}>
        <Tabs.List>
          <ActionButton
            variant="subtle"
            href={detailsPath}
            leftSection={<IconUser size={16} />}
            c={activeTab === "details" ? undefined : "dimmed"}
            fw={activeTab === "details" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "details"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Details
          </ActionButton>
        </Tabs.List>
      </Tabs>

      <Flex flex={1}>
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default AdminBookingLayout;
