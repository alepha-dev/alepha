import {
  NestedView,
  useClient,
  useRouter,
  useRouterState,
} from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, Tabs } from "@mantine/core";
import {
  IconDeviceDesktop,
  IconDevices,
  IconDoor,
  IconQrcode,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
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

const AdminDeviceLayout = () => {
  const router = useRouter<AdmRouter>();
  const state = useRouterState();
  const client = useClient<DeviceController>();
  const deviceId = state.params.deviceId as string;

  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDevice = async () => {
      try {
        const data = await client.getDevice({
          params: { id: deviceId },
        });
        setDevice(data);
      } finally {
        setLoading(false);
      }
    };

    loadDevice();
  }, [deviceId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!device) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Device not found</Text>
      </Flex>
    );
  }

  const detailsPath = router.path("adminDeviceDetails", {
    params: { deviceId },
  });

  const getActiveTab = () => {
    return "details";
  };
  const activeTab = getActiveTab();

  const TypeIcon = typeIcons[device.type] || IconDoor;

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group justify="space-between">
          <Group>
            <TypeIcon size={32} color="var(--mantine-color-blue-6)" />
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="lg" fw={600}>
                  {device.name}
                </Text>
                <Badge size="sm" variant="outline">
                  {device.type.toUpperCase()}
                </Badge>
                <Badge
                  size="sm"
                  variant="light"
                  color={statusColors[device.status] || "gray"}
                >
                  {device.status.charAt(0).toUpperCase() +
                    device.status.slice(1)}
                </Badge>
              </Group>
              <Group gap="xs">
                <Text size="sm" c="dimmed" ff="monospace">
                  {device.serialNumber}
                </Text>
                {device.stationName && (
                  <>
                    <Text size="sm" c="dimmed">
                      •
                    </Text>
                    <Text size="sm" c="dimmed">
                      {device.stationName}
                    </Text>
                  </>
                )}
              </Group>
            </Stack>
          </Group>
          <Stack gap={4} align="flex-end">
            {device.healthScore !== undefined && (
              <>
                <Text
                  size="xl"
                  fw={700}
                  c={
                    device.healthScore >= 80
                      ? "green"
                      : device.healthScore >= 50
                        ? "yellow"
                        : "red"
                  }
                >
                  {device.healthScore}%
                </Text>
                <Text size="xs" c="dimmed">
                  health score
                </Text>
              </>
            )}
          </Stack>
        </Group>
      </Card>

      <Tabs value={activeTab}>
        <Tabs.List>
          <ActionButton
            href={detailsPath}
            leftSection={<IconDevices size={16} />}
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

export default AdminDeviceLayout;
