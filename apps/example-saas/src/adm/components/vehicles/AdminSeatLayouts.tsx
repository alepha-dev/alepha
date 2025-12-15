import { useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group, Stack } from "@mantine/core";
import { IconLayoutGrid, IconTrain } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { SeatLayoutController } from "../../../api/vehicles/controllers/SeatLayoutController.ts";
import type { SeatLayout } from "../../../api/vehicles/entities/seatLayouts.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const AdminSeatLayouts = () => {
  const client = useClient<SeatLayoutController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const filters = t.object({
    query: t.optional(t.text()),
    trainType: t.optional(t.text()),
    active: t.optional(t.boolean()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<SeatLayout, typeof filters>
        submitOnInit
        actions={[
          {
            icon: IconLayoutGrid,
            href: router.path("adminSeatLayoutNew"),
            label: "Create Layout",
          },
        ]}
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
        tableTrProps={(item) => ({
          style: { cursor: "pointer" },
          onClick: () =>
            router.go("adminSeatLayoutEditor", {
              params: { id: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findSeatLayouts({
            query: filters,
          });
          return response as Page<SeatLayout>;
        }}
        columns={{
          name: {
            label: "Name",
            value: (item) => (
              <Stack gap={2}>
                <Group gap="xs">
                  <Text size="sm" fw={600}>
                    {item.name}
                  </Text>
                  {item.isDefault && (
                    <Badge size="xs" variant="light" color="green">
                      Default
                    </Badge>
                  )}
                </Group>
                {item.description && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {item.description}
                  </Text>
                )}
              </Stack>
            ),
          },
          trainType: {
            label: "Train Type",
            fit: true,
            value: (item) => (
              <Badge
                variant="light"
                color="blue"
                size="sm"
                leftSection={<IconTrain size={12} />}
              >
                {item.trainType}
              </Badge>
            ),
          },
          seats: {
            label: "Configuration",
            value: (item) => (
              <Group gap="lg">
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    Total
                  </Text>
                  <Text size="sm" fw={500}>
                    {item.totalSeats} seats
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    1st Class
                  </Text>
                  <Text size="sm" fw={500}>
                    {item.firstClassSeats}
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    2nd Class
                  </Text>
                  <Text size="sm" fw={500}>
                    {item.secondClassSeats}
                  </Text>
                </Stack>
              </Group>
            ),
          },
          wagons: {
            label: "Wagons",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="light" color="grape">
                {item.totalWagons} {item.totalWagons === 1 ? "wagon" : "wagons"}
              </Badge>
            ),
          },
          active: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={item.active ? "green" : "gray"}
              >
                {item.active ? "Active" : "Inactive"}
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

export default AdminSeatLayouts;
