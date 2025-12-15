import { useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group, Progress, Stack } from "@mantine/core";
import { IconTrain } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AdminInventoryController } from "../../../api/inventory/controllers/AdminInventoryController.ts";
import type { TripInstance } from "../../../api/inventory/entities/tripInstances.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  scheduled: "blue",
  boarding: "yellow",
  departed: "green",
  completed: "gray",
  cancelled: "red",
};

const AdminInventory = () => {
  const client = useClient<AdminInventoryController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const filters = t.object({
    query: t.optional(t.text()),
    status: t.optional(
      t.enum(["scheduled", "boarding", "departed", "completed", "cancelled"]),
    ),
    date: t.optional(t.text()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<TripInstance, typeof filters>
        submitOnInit
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        onFilterChange={(key, value, form) => {
          return form.submit();
        }}
        filters={filters}
        items={async (filters) => {
          const response = await client.findTripInstances({
            query: filters,
          });
          return response as Page<TripInstance>;
        }}
        columns={{
          travelDate: {
            label: "Travel Date",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={600}>
                {item.travelDate}
              </Text>
            ),
          },
          trip: {
            label: "Trip",
            value: (item) => (
              <Group gap="xs">
                <IconTrain size={16} />
                <Text size="sm">{item.tripId.slice(0, 8)}...</Text>
              </Group>
            ),
          },
          availability: {
            label: "Availability",
            value: (item) => {
              const booked =
                item.totalSeats -
                item.availableFirstClass -
                item.availableSecondClass;
              const percent = Math.round((booked / item.totalSeats) * 100);
              return (
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      {booked}/{item.totalSeats} seats
                    </Text>
                    <Text size="xs" fw={500}>
                      {percent}%
                    </Text>
                  </Group>
                  <Progress
                    value={percent}
                    color={
                      percent > 80 ? "red" : percent > 50 ? "yellow" : "green"
                    }
                    size="sm"
                  />
                </Stack>
              );
            },
          },
          firstClass: {
            label: "1st Class",
            fit: true,
            value: (item) => (
              <Badge variant="light" color="yellow" size="sm">
                {item.availableFirstClass} available
              </Badge>
            ),
          },
          secondClass: {
            label: "2nd Class",
            fit: true,
            value: (item) => (
              <Badge variant="light" color="gray" size="sm">
                {item.availableSecondClass} available
              </Badge>
            ),
          },
          priceMultiplier: {
            label: "Price Mult.",
            fit: true,
            value: (item) => (
              <Text
                size="sm"
                fw={500}
                c={item.currentPriceMultiplier > 1 ? "red" : "green"}
              >
                {item.currentPriceMultiplier.toFixed(2)}x
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
        }}
      />
    </Flex>
  );
};

export default AdminInventory;
