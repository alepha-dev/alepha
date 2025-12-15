import { useClient } from "@alepha/react";
import { Flex, Text } from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconArrowRight,
  IconMapPin,
  IconRefresh,
  IconRoute,
  IconTrain,
} from "@tabler/icons-react";
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StationController } from "../../../api/topology/controllers/StationController.ts";
import type { TripController } from "../../../api/topology/controllers/TripController.ts";
import type { StationResource } from "../../../api/topology/schemas/stationSchema.ts";
import type { TripWithStations, ViewMode } from "./AdminTopologyBrowser.tsx";

type BrowserComponentProps = {
  validStations: StationResource[];
  uniqueRoutes: TripWithStations[];
  viewMode: ViewMode;
  onStationClick: (id: string) => void;
};

const AdminTopology = () => {
  const stationClient = useClient<StationController>();
  const tripClient = useClient<TripController>();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const [stations, setStations] = useState<StationResource[]>([]);
  const [trips, setTrips] = useState<TripWithStations[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [MapComponent, setMapComponent] =
    useState<ComponentType<BrowserComponentProps> | null>(null);

  // Use refs to avoid dependency issues in loadData
  const stationClientRef = useRef(stationClient);
  const tripClientRef = useRef(tripClient);
  stationClientRef.current = stationClient;
  tripClientRef.current = tripClient;

  // Load map component on client side only
  useEffect(() => {
    import("./AdminTopologyBrowser.tsx").then((mod) => {
      setMapComponent(() => mod.default);
    });
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [stationsData, tripsData] = await Promise.all([
        stationClientRef.current.getStations({}),
        tripClientRef.current.getTrips({}),
      ]);

      setStations(stationsData);

      // Build trips with station info
      const stationMap = new Map(stationsData.map((s) => [s.id, s]));
      const tripsWithStations: TripWithStations[] = [];

      for (const trip of tripsData) {
        const departure = stationMap.get(trip.departureStationId);
        const arrival = stationMap.get(trip.arrivalStationId);
        if (departure && arrival) {
          tripsWithStations.push({
            id: trip.id,
            trainNumber: trip.trainNumber,
            trainType: trip.trainType,
            departureTime: trip.departureTime,
            arrivalTime: trip.arrivalTime,
            departureStation: departure,
            arrivalStation: arrival,
          });
        }
      }

      setTrips(tripsWithStations);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter stations that have coordinates
  const validStations = useMemo(
    () => stations.filter((s) => s.latitude && s.longitude),
    [stations],
  );

  // Get unique routes (dedupe by station pair)
  const uniqueRoutes = useMemo(() => {
    const seen = new Set<string>();
    return trips.filter((t) => {
      const key = [t.departureStation.id, t.arrivalStation.id].sort().join("-");
      if (seen.has(key)) return false;
      seen.add(key);
      return (
        t.departureStation.latitude &&
        t.departureStation.longitude &&
        t.arrivalStation.latitude &&
        t.arrivalStation.longitude
      );
    });
  }, [trips]);

  // Get trips for selected station
  const selectedStationTrips = useMemo(() => {
    if (!selectedStation) return [];
    return trips.filter(
      (t) =>
        t.departureStation.id === selectedStation ||
        t.arrivalStation.id === selectedStation,
    );
  }, [trips, selectedStation]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  return (
    <Flex flex={1} gap="xs" h="100%">
      {/* Map Panel */}
      <Card withBorder flex={1} p={0} style={{ overflow: "hidden" }}>
        {MapComponent ? (
          <MapComponent
            validStations={validStations}
            uniqueRoutes={uniqueRoutes}
            viewMode={viewMode}
            onStationClick={setSelectedStation}
          />
        ) : (
          <Flex flex={1} justify="center" align="center" h="100%">
            <Loader />
          </Flex>
        )}
      </Card>

      {/* Side Panel */}
      <Card withBorder w={320} h="100%" style={{ flexShrink: 0 }}>
        <Stack gap="xs" h="100%">
          {/* Header */}
          <Group justify="space-between">
            <Group gap="xs">
              <IconMapPin size={18} />
              <Text size="sm" fw={500}>
                Network Topology
              </Text>
            </Group>
            <Tooltip label="Refresh">
              <ActionIcon variant="subtle" size="sm" onClick={loadData}>
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {/* View Mode Toggle */}
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            data={[
              { label: "All", value: "all" },
              { label: "Stations", value: "stations" },
              { label: "Routes", value: "routes" },
            ]}
          />

          {/* Stats */}
          <Group gap="xs">
            <Badge
              variant="light"
              color="blue"
              leftSection={<IconMapPin size={12} />}
            >
              {validStations.length} stations
            </Badge>
            <Badge
              variant="light"
              color="teal"
              leftSection={<IconRoute size={12} />}
            >
              {uniqueRoutes.length} routes
            </Badge>
          </Group>

          {/* Station List */}
          <ScrollArea flex={1} offsetScrollbars>
            <Stack gap={4}>
              {validStations.map((station) => (
                <Card
                  key={station.id}
                  p="xs"
                  withBorder
                  style={{
                    cursor: "pointer",
                    backgroundColor:
                      selectedStation === station.id
                        ? isDark
                          ? "var(--mantine-color-dark-5)"
                          : "var(--mantine-color-blue-0)"
                        : undefined,
                  }}
                  onClick={() => setSelectedStation(station.id)}
                >
                  <Group gap="xs" wrap="nowrap">
                    <IconTrain size={14} color="var(--mantine-color-dimmed)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={500} lineClamp={1}>
                        {station.name}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {station.city}, {station.country}
                      </Text>
                    </div>
                    <Badge size="xs" variant="outline">
                      {station.code}
                    </Badge>
                  </Group>
                </Card>
              ))}
            </Stack>
          </ScrollArea>

          {/* Selected Station Trips */}
          {selectedStation && selectedStationTrips.length > 0 && (
            <>
              <Text size="xs" fw={500} c="dimmed">
                Connections
              </Text>
              <ScrollArea h={150} offsetScrollbars>
                <Stack gap={4}>
                  {selectedStationTrips.slice(0, 10).map((trip) => {
                    const isOrigin =
                      trip.departureStation.id === selectedStation;
                    const otherStation = isOrigin
                      ? trip.arrivalStation
                      : trip.departureStation;

                    return (
                      <Group key={trip.id} gap="xs" wrap="nowrap">
                        <Badge size="xs" variant="light">
                          {trip.trainType}
                        </Badge>
                        <IconArrowRight
                          size={12}
                          color="var(--mantine-color-dimmed)"
                        />
                        <Text size="xs" lineClamp={1} style={{ flex: 1 }}>
                          {otherStation.name}
                        </Text>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {trip.departureTime}
                        </Text>
                      </Group>
                    );
                  })}
                </Stack>
              </ScrollArea>
            </>
          )}
        </Stack>
      </Card>
    </Flex>
  );
};

export default AdminTopology;
