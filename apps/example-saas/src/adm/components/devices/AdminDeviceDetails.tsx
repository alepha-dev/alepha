import { useAction, useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  Progress,
  Stack,
  ThemeIcon,
} from "@mantine/core";
import {
  IconActivity,
  IconAlertTriangle,
  IconBan,
  IconCheck,
  IconNetwork,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconTool,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { DeviceController } from "../../../api/devices/controllers/DeviceController.ts";
import type { Device } from "../../../api/devices/entities/devices.ts";

const statusColors: Record<string, string> = {
  online: "green",
  offline: "gray",
  maintenance: "yellow",
  error: "red",
  disabled: "dark",
};

const AdminDeviceDetails = () => {
  const state = useRouterState();
  const client = useClient<DeviceController>();
  const { l } = useI18n();
  const deviceId = state.params.deviceId as string;

  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    loadDevice();
  }, [deviceId]);

  const enableAction = useAction(
    {
      handler: async () => {
        await client.enableDevice({ params: { id: deviceId } });
        loadDevice();
      },
    },
    [deviceId],
  );

  const disableAction = useAction(
    {
      handler: async () => {
        await client.disableDevice({ params: { id: deviceId }, body: {} });
        loadDevice();
      },
    },
    [deviceId],
  );

  const enterMaintenanceAction = useAction(
    {
      handler: async () => {
        await client.setMaintenanceMode({
          params: { id: deviceId },
          body: {},
        });
        loadDevice();
      },
    },
    [deviceId],
  );

  const exitMaintenanceAction = useAction(
    {
      handler: async () => {
        await client.completeMaintenace({
          params: { id: deviceId },
          body: {},
        });
        loadDevice();
      },
    },
    [deviceId],
  );

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

  return (
    <Flex flex={1} direction="column" gap="md">
      <Grid>
        {/* Health & Status Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Health & Status</Text>
                <Badge
                  size="lg"
                  variant="light"
                  color={statusColors[device.status]}
                >
                  {device.status.charAt(0).toUpperCase() +
                    device.status.slice(1)}
                </Badge>
              </Group>

              {device.healthScore !== undefined && (
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Health Score
                    </Text>
                    <Text
                      size="sm"
                      fw={500}
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
                  </Group>
                  <Progress
                    value={device.healthScore}
                    color={
                      device.healthScore >= 80
                        ? "green"
                        : device.healthScore >= 50
                          ? "yellow"
                          : "red"
                    }
                    size="md"
                  />
                </Stack>
              )}

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconActivity size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Last Seen
                  </Text>
                  <Text size="sm">
                    {device.lastSeenAt
                      ? l(device.lastSeenAt, { date: "fromNow" })
                      : "Never"}
                  </Text>
                </Group>

                {device.lastErrorAt && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="red">
                      <IconAlertTriangle size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Last Error
                    </Text>
                    <Text size="sm" c="red">
                      {l(device.lastErrorAt, { date: "fromNow" })}
                    </Text>
                  </Group>
                )}

                {device.lastErrorMessage && (
                  <Text size="sm" c="red" pl={32}>
                    {device.lastErrorMessage}
                  </Text>
                )}

                {device.uptimePercent !== undefined && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="green">
                      <IconCheck size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Uptime
                    </Text>
                    <Text size="sm">{device.uptimePercent.toFixed(2)}%</Text>
                  </Group>
                )}
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Network Info Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Network</Text>

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconNetwork size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    IP Address
                  </Text>
                  <Text size="sm" ff="monospace">
                    {device.ipAddress || "—"}
                  </Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconNetwork size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    MAC Address
                  </Text>
                  <Text size="sm" ff="monospace">
                    {device.macAddress || "—"}
                  </Text>
                </Group>

                {device.apiEndpoint && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconNetwork size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      API Endpoint
                    </Text>
                    <Text size="sm" ff="monospace" truncate>
                      {device.apiEndpoint}
                    </Text>
                  </Group>
                )}
              </Stack>

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconSettings size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Model
                  </Text>
                  <Text size="sm">{device.model || "—"}</Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconSettings size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Manufacturer
                  </Text>
                  <Text size="sm">{device.manufacturer || "—"}</Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconRefresh size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Firmware
                  </Text>
                  <Text size="sm" ff="monospace">
                    {device.firmwareVersion || "—"}
                  </Text>
                </Group>
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Usage Statistics Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Usage Statistics</Text>

              <Grid>
                <Grid.Col span={6}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">
                      Total Transactions
                    </Text>
                    <Text size="xl" fw={700}>
                      {device.totalTransactions.toLocaleString()}
                    </Text>
                  </Stack>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">
                      Today
                    </Text>
                    <Text size="xl" fw={700} c="blue">
                      {device.todayTransactions.toLocaleString()}
                    </Text>
                  </Stack>
                </Grid.Col>
              </Grid>

              <Group gap="sm">
                <ThemeIcon size="sm" variant="light" color="red">
                  <IconAlertTriangle size={14} />
                </ThemeIcon>
                <Text size="sm" c="dimmed" w={100}>
                  Total Errors
                </Text>
                <Text
                  size="sm"
                  fw={500}
                  c={device.totalErrors > 0 ? "red" : undefined}
                >
                  {device.totalErrors}
                </Text>
              </Group>

              {/* Type-specific info */}
              {device.type === "tvm" && (
                <>
                  {device.tvmCashLevel !== undefined && (
                    <Stack gap="xs">
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                          Cash Level
                        </Text>
                        <Text size="sm" fw={500}>
                          {device.tvmCashLevel}%
                        </Text>
                      </Group>
                      <Progress
                        value={device.tvmCashLevel}
                        color={device.tvmCashLevel < 20 ? "red" : "blue"}
                        size="sm"
                      />
                    </Stack>
                  )}
                  {device.tvmPaperLevel !== undefined && (
                    <Stack gap="xs">
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                          Paper Level
                        </Text>
                        <Text size="sm" fw={500}>
                          {device.tvmPaperLevel}%
                        </Text>
                      </Group>
                      <Progress
                        value={device.tvmPaperLevel}
                        color={device.tvmPaperLevel < 20 ? "red" : "blue"}
                        size="sm"
                      />
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Actions Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Actions</Text>

              <Stack gap="sm">
                {device.status !== "disabled" && (
                  <ActionButton
                    variant="light"
                    color="red"
                    leftSection={<IconBan size={16} />}
                    onClick={disableAction.run}
                    loading={disableAction.loading}
                    fullWidth
                  >
                    Disable Device
                  </ActionButton>
                )}

                {device.status === "disabled" && (
                  <ActionButton
                    variant="light"
                    color="green"
                    leftSection={<IconPlayerPlay size={16} />}
                    onClick={enableAction.run}
                    loading={enableAction.loading}
                    fullWidth
                  >
                    Enable Device
                  </ActionButton>
                )}

                {device.status === "maintenance" ? (
                  <ActionButton
                    variant="light"
                    color="green"
                    leftSection={<IconPlayerPlay size={16} />}
                    onClick={exitMaintenanceAction.run}
                    loading={exitMaintenanceAction.loading}
                    fullWidth
                  >
                    Exit Maintenance
                  </ActionButton>
                ) : (
                  <ActionButton
                    variant="light"
                    color="yellow"
                    leftSection={<IconTool size={16} />}
                    onClick={enterMaintenanceAction.run}
                    loading={enterMaintenanceAction.loading}
                    fullWidth
                  >
                    Enter Maintenance Mode
                  </ActionButton>
                )}
              </Stack>

              {/* Maintenance Info */}
              {device.lastMaintenanceAt && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Maintenance
                  </Text>
                  <Group gap="sm">
                    <Text size="sm" c="dimmed">
                      Last maintenance:
                    </Text>
                    <Text size="sm">
                      {l(device.lastMaintenanceAt, { date: "fromNow" })}
                    </Text>
                  </Group>
                  {device.nextMaintenanceAt && (
                    <Group gap="sm">
                      <Text size="sm" c="dimmed">
                        Next scheduled:
                      </Text>
                      <Text size="sm">
                        {l(device.nextMaintenanceAt, { date: "medium" })}
                      </Text>
                    </Group>
                  )}
                </Stack>
              )}

              {device.maintenanceNotes && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Notes
                  </Text>
                  <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                    {device.maintenanceNotes}
                  </Text>
                </Stack>
              )}

              {device.tags && device.tags.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Tags
                  </Text>
                  <Group gap="xs">
                    {device.tags.map((tag) => (
                      <Badge key={tag} size="sm" variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Flex>
  );
};

export default AdminDeviceDetails;
