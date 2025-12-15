import { useAction, useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDeviceDesktop,
  IconDoor,
  IconPlus,
  IconQrcode,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { DeviceController } from "../../../api/devices/controllers/DeviceController.ts";
import type { Device } from "../../../api/devices/entities/devices.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  online: "green",
  offline: "gray",
  maintenance: "yellow",
  error: "red",
  disabled: "dark",
};

const typeIcons: Record<string, typeof IconDoor> = {
  gate: IconDoor,
  tvm: IconDeviceDesktop,
  validator: IconQrcode,
};

const AdminDevices = () => {
  const client = useClient<DeviceController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createForm, setCreateForm] = useState({
    type: "" as "" | "gate" | "tvm" | "validator",
    name: "",
    serialNumber: "",
    model: "",
    manufacturer: "",
    stationName: "",
    zone: "",
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.type || !createForm.name || !createForm.serialNumber)
          return;

        await client.createDevice({
          body: {
            type: createForm.type,
            name: createForm.name,
            serialNumber: createForm.serialNumber,
            model: createForm.model || undefined,
            manufacturer: createForm.manufacturer || undefined,
            stationName: createForm.stationName || undefined,
            zone: createForm.zone || undefined,
          },
        });

        closeCreate();
        setCreateForm({
          type: "",
          name: "",
          serialNumber: "",
          model: "",
          manufacturer: "",
          stationName: "",
          zone: "",
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    type: t.optional(t.enum(["gate", "tvm", "validator"])),
    status: t.optional(
      t.enum(["online", "offline", "maintenance", "error", "disabled"]),
    ),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<Device, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconPlus,
            onClick: openCreate,
            label: "Add Device",
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
            router.go("adminDeviceDetails", {
              params: { deviceId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findDevices({
            query: filters,
          });
          return response as Page<Device>;
        }}
        columns={{
          device: {
            label: "Device",
            value: (item) => {
              const TypeIcon = typeIcons[item.type] || IconDoor;
              return (
                <Group gap="sm">
                  <TypeIcon size={20} color="var(--mantine-color-dimmed)" />
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      {item.name}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {item.serialNumber}
                    </Text>
                  </Stack>
                </Group>
              );
            },
          },
          type: {
            label: "Type",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="outline">
                {item.type.toUpperCase()}
              </Badge>
            ),
          },
          location: {
            label: "Location",
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm">{item.stationName || "—"}</Text>
                {item.zone && (
                  <Text size="xs" c="dimmed">
                    {item.zone}
                  </Text>
                )}
              </Stack>
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
          health: {
            label: "Health",
            fit: true,
            value: (item) => (
              <Text
                size="sm"
                fw={500}
                c={
                  item.healthScore && item.healthScore >= 80
                    ? "green"
                    : item.healthScore && item.healthScore >= 50
                      ? "yellow"
                      : "red"
                }
              >
                {item.healthScore !== undefined ? `${item.healthScore}%` : "—"}
              </Text>
            ),
          },
          lastSeen: {
            label: "Last Seen",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.lastSeenAt
                  ? l(item.lastSeenAt, { date: "fromNow" })
                  : "—"}
              </Text>
            ),
          },
        }}
      />

      {/* Create Device Modal */}
      <Modal opened={createOpened} onClose={closeCreate} title="Add Device">
        <Stack gap="md">
          <Select
            label="Device Type"
            placeholder="Select type"
            required
            data={[
              { value: "gate", label: "Gate (Access Control)" },
              { value: "tvm", label: "TVM (Ticket Vending Machine)" },
              { value: "validator", label: "Validator (Ticket Scanner)" },
            ]}
            value={createForm.type}
            onChange={(v) =>
              setCreateForm({
                ...createForm,
                type: (v as "gate" | "tvm" | "validator") || "",
              })
            }
          />

          <TextInput
            label="Device Name"
            placeholder="Gate A1, TVM-North-01"
            required
            value={createForm.name}
            onChange={(e) =>
              setCreateForm({ ...createForm, name: e.currentTarget.value })
            }
          />

          <TextInput
            label="Serial Number"
            placeholder="SN-123456789"
            required
            value={createForm.serialNumber}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                serialNumber: e.currentTarget.value,
              })
            }
          />

          <Group grow>
            <TextInput
              label="Manufacturer"
              placeholder="Scheidt & Bachmann"
              value={createForm.manufacturer}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  manufacturer: e.currentTarget.value,
                })
              }
            />
            <TextInput
              label="Model"
              placeholder="SB-5000"
              value={createForm.model}
              onChange={(e) =>
                setCreateForm({ ...createForm, model: e.currentTarget.value })
              }
            />
          </Group>

          <Group grow>
            <TextInput
              label="Station"
              placeholder="Paris Gare du Nord"
              value={createForm.stationName}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  stationName: e.currentTarget.value,
                })
              }
            />
            <TextInput
              label="Zone"
              placeholder="Platform 1"
              value={createForm.zone}
              onChange={(e) =>
                setCreateForm({ ...createForm, zone: e.currentTarget.value })
              }
            />
          </Group>

          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeCreate}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="blue"
              onClick={createAction.run}
              loading={createAction.loading}
              disabled={
                !createForm.type || !createForm.name || !createForm.serialNumber
              }
            >
              Add Device
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminDevices;
