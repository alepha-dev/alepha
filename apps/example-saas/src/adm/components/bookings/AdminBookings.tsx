import { useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { BookingController } from "../../../api/bookings/controllers/BookingController.ts";
import type { Booking } from "../../../api/bookings/entities/bookings.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  pending: "yellow",
  confirmed: "green",
  cancelled: "red",
};

const AdminBookings = () => {
  const client = useClient<BookingController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const filters = t.object({
    query: t.optional(t.text()),
    status: t.optional(t.enum(["pending", "confirmed", "cancelled"])),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<Booking, typeof filters>
        submitOnInit
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 2,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        onFilterChange={(key, value, form) => {
          if (key === "query" || key === "status") {
            return form.submit();
          }
        }}
        filters={filters}
        tableTrProps={(item) => ({
          style: { cursor: "pointer" },
          onClick: () =>
            router.go("adminBookingDetails", {
              params: { bookingId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findBookings({
            query: filters,
          });
          return response as Page<Booking>;
        }}
        columns={{
          reference: {
            label: "Reference",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={600} ff="monospace">
                {item.reference}
              </Text>
            ),
          },
          route: {
            label: "Route",
            value: (item) => (
              <Group gap="xs" wrap="nowrap">
                <Text size="sm" lineClamp={1}>
                  {item.departureStation.split(" ")[0]}
                </Text>
                <IconArrowRight size={12} color="var(--mantine-color-dimmed)" />
                <Text size="sm" lineClamp={1}>
                  {item.arrivalStation.split(" ")[0]}
                </Text>
              </Group>
            ),
          },
          passenger: {
            label: "Passenger",
            value: (item) => (
              <Flex direction="column" gap={2}>
                <Text size="sm" fw={500}>
                  {item.passengerFirstName} {item.passengerLastName}
                </Text>
                <Text size="xs" c="dimmed">
                  {item.passengerEmail}
                </Text>
              </Flex>
            ),
          },
          travelDate: {
            label: "Travel Date",
            fit: true,
            value: (item) => <Text size="sm">{item.travelDate}</Text>,
          },
          totalPrice: {
            label: "Total",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={500}>
                {item.totalPrice.toFixed(2)}
              </Text>
            ),
          },
          status: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={statusColors[item.status] || "gray"}
              >
                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </Badge>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
      />
    </Flex>
  );
};

export default AdminBookings;
