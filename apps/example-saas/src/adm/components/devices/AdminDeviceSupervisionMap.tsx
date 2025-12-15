import { Flex } from "@alepha/ui";
import { Badge, useMantineColorScheme } from "@mantine/core";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";

export interface StationWithHealth {
  id: string;
  name: string;
  code: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  deviceCount: number;
  onlineCount: number;
  offlineCount: number;
  errorCount: number;
  maintenanceCount: number;
  avgHealthScore: number;
}

interface AdminDeviceSupervisionMapProps {
  stations: StationWithHealth[];
  selectedStationId: string | null;
  onStationClick: (id: string) => void;
}

// Component to fit bounds when stations change
const FitBounds = ({ stations }: { stations: StationWithHealth[] }) => {
  const map = useMap();

  useEffect(() => {
    if (stations.length === 0) return;

    const bounds = L.latLngBounds(
      stations.map((s) => [s.latitude, s.longitude] as [number, number]),
    );

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [stations, map]);

  return null;
};

// Get health color based on station health
const getHealthColor = (station: StationWithHealth): string => {
  if (station.deviceCount === 0) return "#868e96"; // gray - no devices
  if (station.errorCount > 0) return "#fa5252"; // red - has errors
  if (station.offlineCount > station.deviceCount / 2) return "#fd7e14"; // orange - many offline
  if (station.avgHealthScore >= 80) return "#40c057"; // green - healthy
  if (station.avgHealthScore >= 50) return "#fab005"; // yellow - warning
  return "#fa5252"; // red - critical
};

const AdminDeviceSupervisionMap = ({
  stations,
  selectedStationId,
  onStationClick,
}: AdminDeviceSupervisionMapProps) => {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  // Tile layer based on theme
  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  if (stations.length === 0) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Badge color="gray">No stations with devices</Badge>
      </Flex>
    );
  }

  return (
    <MapContainer
      center={[48.8566, 2.3522]}
      zoom={5}
      style={{ height: "100%", width: "100%" }}
      attributionControl={false}
    >
      <TileLayer url={tileUrl} />
      <FitBounds stations={stations} />

      {/* Station markers */}
      {stations.map((station) => {
        const isSelected = selectedStationId === station.id;
        const color = getHealthColor(station);
        const radius = Math.max(8, Math.min(20, 8 + station.deviceCount * 2));

        return (
          <CircleMarker
            key={station.id}
            center={[station.latitude, station.longitude]}
            radius={isSelected ? radius + 4 : radius}
            pathOptions={{
              color: isSelected ? "#228be6" : color,
              fillColor: color,
              fillOpacity: 0.8,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => onStationClick(station.id),
            }}
          />
        );
      })}
    </MapContainer>
  );
};

export default AdminDeviceSupervisionMap;
