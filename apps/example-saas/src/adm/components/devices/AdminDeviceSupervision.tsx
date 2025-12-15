import { useClient } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Text } from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Card,
  Divider,
  Flex,
  Group,
  Loader,
  Progress,
  ScrollArea,
  Stack,
  ThemeIcon,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconActivity,
  IconAlertTriangle,
  IconCheck,
  IconDeviceDesktop,
  IconDoor,
  IconMapPin,
  IconPower,
  IconRefresh,
  IconStethoscope,
  IconTicket,
  IconX,
} from "@tabler/icons-react";
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DeviceController } from "../../../api/devices/controllers/DeviceController.ts";
import type { Device } from "../../../api/devices/entities/devices.ts";
import type { StationController } from "../../../api/topology/controllers/StationController.ts";
import type { StationResource } from "../../../api/topology/schemas/stationSchema.ts";
import type { StationWithHealth } from "./AdminDeviceSupervisionMap.tsx";

type MapComponentProps = {
  stations: StationWithHealth[];
  selectedStationId: string | null;
  onStationClick: (id: string) => void;
};

const statusColors: Record<string, string> = {
  online: "green",
  offline: "gray",
  maintenance: "yellow",
  error: "red",
  disabled: "dark",
};

const statusIcons: Record<string, typeof IconCheck> = {
  online: IconCheck,
  offline: IconX,
  maintenance: IconActivity,
  error: IconAlertTriangle,
  disabled: IconPower,
};

const deviceTypeIcons: Record<string, typeof IconDeviceDesktop> = {
  gate: IconDoor,
  tvm: IconTicket,
  validator: IconDeviceDesktop,
};

const AdminDeviceSupervision = () => {
  const stationClient = useClient<StationController>();
  const deviceClient = useClient<DeviceController>();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const { l } = useI18n();

  const [stations, setStations] = useState<StationResource[]>([]);
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    null,
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [MapComponent, setMapComponent] =
    useState<ComponentType<MapComponentProps> | null>(null);

  // Use refs to avoid dependency issues
  const stationClientRef = useRef(stationClient);
  const deviceClientRef = useRef(deviceClient);
  stationClientRef.current = stationClient;
  deviceClientRef.current = deviceClient;

  // Load map component on client side only
  useEffect(() => {
    import("./AdminDeviceSupervisionMap.tsx").then((mod) => {
      setMapComponent(() => mod.default);
    });
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [stationsData, devicesData] = await Promise.all([
        stationClientRef.current.getStations({}),
        deviceClientRef.current.findDevices({ query: { size: 100 } }),
      ]);

      setStations(stationsData);
      setAllDevices(devicesData.content);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Build stations with health data
  const stationsWithHealth = useMemo(() => {
    const result: StationWithHealth[] = [];

    for (const station of stations) {
      if (!station.latitude || !station.longitude) continue;

      const stationDevices = allDevices.filter(
        (d) => d.stationId === station.id,
      );
      if (stationDevices.length === 0) continue;

      const onlineCount = stationDevices.filter(
        (d) => d.status === "online",
      ).length;
      const offlineCount = stationDevices.filter(
        (d) => d.status === "offline",
      ).length;
      const errorCount = stationDevices.filter(
        (d) => d.status === "error",
      ).length;
      const maintenanceCount = stationDevices.filter(
        (d) => d.status === "maintenance",
      ).length;

      const healthScores = stationDevices
        .filter((d) => d.healthScore !== undefined && d.healthScore !== null)
        .map((d) => d.healthScore as number);

      const avgHealthScore =
        healthScores.length > 0
          ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length
          : 0;

      result.push({
        id: station.id,
        name: station.name,
        code: station.code,
        city: station.city,
        country: station.country,
        latitude: station.latitude,
        longitude: station.longitude,
        deviceCount: stationDevices.length,
        onlineCount,
        offlineCount,
        errorCount,
        maintenanceCount,
        avgHealthScore,
      });
    }

    return result;
  }, [stations, allDevices]);

  // Get devices for selected station
  const selectedStationDevices = useMemo(() => {
    if (!selectedStationId) return [];
    return allDevices.filter((d) => d.stationId === selectedStationId);
  }, [allDevices, selectedStationId]);

  const selectedStation = useMemo(() => {
    return stationsWithHealth.find((s) => s.id === selectedStationId);
  }, [stationsWithHealth, selectedStationId]);

  // Actions
  const handleReboot = async (deviceId: string) => {
    setActionLoading(deviceId);
    try {
      await deviceClient.rebootDevice({ params: { id: deviceId } });
      await loadData();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDiagnose = async (deviceId: string) => {
    setActionLoading(`diagnose-${deviceId}`);
    try {
      const result = await deviceClient.diagnoseDevice({
        params: { id: deviceId },
      });
      // In a real app, we'd show this in a modal
      console.log("Diagnostics:", result.diagnostics);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  return (
    <Flex flex={1} h="100%">
      {/* Map Panel */}
      <Flex flex={1} p={0} style={{ overflow: "hidden" }}>
        {MapComponent ? (
          <MapComponent
            stations={stationsWithHealth}
            selectedStationId={selectedStationId}
            onStationClick={setSelectedStationId}
          />
        ) : (
          <Flex flex={1} justify="center" align="center" h="100%">
            <Loader />
          </Flex>
        )}
      </Flex>

      {/* Side Panel */}
      <Flex
        p={"md"}
        bg={"var(--alepha-background)"}
        w={360}
        h="100%"
        style={{ flexShrink: 0 }}
      >
        <Stack gap="xs" h="100%" w={"100%"}>
          {/* Header */}
          <Group justify="space-between">
            <Group gap="xs">
              <IconMapPin size={18} />
              <Text size="sm" fw={500}>
                Device Supervision
              </Text>
            </Group>
            <Tooltip label="Refresh">
              <ActionIcon variant="subtle" size="sm" onClick={loadData}>
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {/* Stats */}
          <Group gap="xs">
            <Badge
              variant="light"
              color="blue"
              leftSection={<IconMapPin size={12} />}
            >
              {stationsWithHealth.length} stations
            </Badge>
            <Badge
              variant="light"
              color="teal"
              leftSection={<IconDeviceDesktop size={12} />}
            >
              {allDevices.length} devices
            </Badge>
          </Group>

          <Divider />

          {/* Station List or Selected Station */}
          {selectedStation ? (
            <Stack gap="xs" style={{ flex: 1, overflow: "hidden" }}>
              {/* Selected station header */}
              <Card withBorder p="xs" bg={isDark ? "dark.6" : "gray.0"}>
                <Group justify="space-between">
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>
                      {selectedStation.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {selectedStation.city}, {selectedStation.country}
                    </Text>
                  </Stack>
                  <ActionButton
                    size="xs"
                    variant="subtle"
                    onClick={() => setSelectedStationId(null)}
                  >
                    Back
                  </ActionButton>
                </Group>
              </Card>

              {/* Station health overview */}
              <Group gap="xs">
                <Badge size="sm" color="green" variant="light">
                  {selectedStation.onlineCount} online
                </Badge>
                <Badge size="sm" color="gray" variant="light">
                  {selectedStation.offlineCount} offline
                </Badge>
                {selectedStation.errorCount > 0 && (
                  <Badge size="sm" color="red" variant="light">
                    {selectedStation.errorCount} error
                  </Badge>
                )}
              </Group>

              {/* Health bar */}
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Station Health
                  </Text>
                  <Text size="xs" fw={500}>
                    {selectedStation.avgHealthScore.toFixed(0)}%
                  </Text>
                </Group>
                <Progress
                  value={selectedStation.avgHealthScore}
                  color={
                    selectedStation.avgHealthScore >= 80
                      ? "green"
                      : selectedStation.avgHealthScore >= 50
                        ? "yellow"
                        : "red"
                  }
                  size="sm"
                />
              </Stack>

              <Divider />

              {/* Devices list */}
              <Text size="xs" fw={500} c="dimmed">
                Devices ({selectedStationDevices.length})
              </Text>

              <ScrollArea flex={1} offsetScrollbars>
                <Stack gap={6}>
                  {selectedStationDevices.map((device) => {
                    const StatusIcon = statusIcons[device.status] || IconX;
                    const DeviceIcon =
                      deviceTypeIcons[device.type] || IconDeviceDesktop;

                    return (
                      <Card key={device.id} withBorder p="xs">
                        <Stack gap="xs">
                          <Group justify="space-between" wrap="nowrap">
                            <Group
                              gap="xs"
                              wrap="nowrap"
                              style={{ flex: 1, minWidth: 0 }}
                            >
                              <ThemeIcon
                                size="sm"
                                variant="light"
                                color={statusColors[device.status]}
                              >
                                <DeviceIcon size={14} />
                              </ThemeIcon>
                              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                                <Text size="sm" fw={500} lineClamp={1}>
                                  {device.name}
                                </Text>
                                <Text size="xs" c="dimmed" lineClamp={1}>
                                  {device.zone || device.type}
                                </Text>
                              </Stack>
                            </Group>
                            <Badge
                              size="xs"
                              variant="light"
                              color={statusColors[device.status]}
                              leftSection={<StatusIcon size={10} />}
                            >
                              {device.status}
                            </Badge>
                          </Group>

                          {/* Health score */}
                          {device.healthScore !== undefined && (
                            <Progress
                              value={device.healthScore}
                              size="xs"
                              color={
                                device.healthScore >= 80
                                  ? "green"
                                  : device.healthScore >= 50
                                    ? "yellow"
                                    : "red"
                              }
                            />
                          )}

                          {/* Actions */}
                          <Group gap="xs">
                            <Tooltip label="Reboot device">
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="orange"
                                loading={actionLoading === device.id}
                                onClick={() => handleReboot(device.id)}
                              >
                                <IconPower size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Run diagnostics">
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="blue"
                                loading={
                                  actionLoading === `diagnose-${device.id}`
                                }
                                onClick={() => handleDiagnose(device.id)}
                              >
                                <IconStethoscope size={14} />
                              </ActionIcon>
                            </Tooltip>
                            {device.lastSeenAt && (
                              <Text size="xs" c="dimmed" ml="auto">
                                {l(device.lastSeenAt, { date: "fromNow" })}
                              </Text>
                            )}
                          </Group>
                        </Stack>
                      </Card>
                    );
                  })}
                </Stack>
              </ScrollArea>
            </Stack>
          ) : (
            <ScrollArea flex={1} offsetScrollbars>
              <Stack gap={4}>
                {stationsWithHealth.map((station) => {
                  const healthColor =
                    station.avgHealthScore >= 80
                      ? "green"
                      : station.avgHealthScore >= 50
                        ? "yellow"
                        : "red";

                  return (
                    <Card
                      key={station.id}
                      p="xs"
                      withBorder
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedStationId(station.id)}
                    >
                      <Group gap="xs" wrap="nowrap">
                        <ThemeIcon
                          size="sm"
                          variant="light"
                          color={station.errorCount > 0 ? "red" : healthColor}
                        >
                          <IconMapPin size={14} />
                        </ThemeIcon>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" fw={500} lineClamp={1}>
                            {station.name}
                          </Text>
                          <Group gap={4}>
                            <Text size="xs" c="dimmed">
                              {station.deviceCount} devices
                            </Text>
                            {station.errorCount > 0 && (
                              <Badge size="xs" color="red" variant="light">
                                {station.errorCount} error
                              </Badge>
                            )}
                          </Group>
                        </div>
                        <Stack gap={2} align="flex-end">
                          <Badge
                            size="xs"
                            color={healthColor}
                            variant="outline"
                          >
                            {station.avgHealthScore.toFixed(0)}%
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {station.onlineCount}/{station.deviceCount} online
                          </Text>
                        </Stack>
                      </Group>
                    </Card>
                  );
                })}
              </Stack>
            </ScrollArea>
          )}
        </Stack>
      </Flex>
    </Flex>
  );
};

export default AdminDeviceSupervision;
