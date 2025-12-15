import { Flex, Text } from "@alepha/ui";
import { Badge, useMantineColorScheme } from "@mantine/core";
import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { StationResource } from "../../../api/topology/schemas/stationSchema.ts";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

// Fix Leaflet default marker icon issue
// @ts-expect-error - leaflet internal
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

export interface TripWithStations {
  id: string;
  trainNumber: string;
  trainType: string;
  departureTime: string;
  arrivalTime: string;
  departureStation: StationResource;
  arrivalStation: StationResource;
}

export type ViewMode = "all" | "stations" | "routes";

interface AdminTopologyBrowserProps {
  validStations: StationResource[];
  uniqueRoutes: TripWithStations[];
  viewMode: ViewMode;
  onStationClick: (id: string) => void;
}

// Component to fit bounds when stations change
const FitBounds = ({ stations }: { stations: StationResource[] }) => {
  const map = useMap();

  useEffect(() => {
    if (stations.length === 0) return;

    const bounds = L.latLngBounds(
      stations
        .filter((s) => s.latitude && s.longitude)
        .map((s) => [s.latitude, s.longitude] as [number, number]),
    );

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [stations, map]);

  return null;
};

const AdminTopologyBrowser = ({
  validStations,
  uniqueRoutes,
  viewMode,
  onStationClick,
}: AdminTopologyBrowserProps) => {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  // Custom station icon
  const stationIcon = useMemo(
    () =>
      L.divIcon({
        html: `<div style="
        width: 24px;
        height: 24px;
        background: ${isDark ? "#228be6" : "#1971c2"};
        border: 3px solid ${isDark ? "#1c7ed6" : "#1864ab"};
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>`,
        className: "station-marker",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
      }),
    [isDark],
  );

  // Tile layer based on theme
  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  if (validStations.length === 0) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Badge color="gray">No stations with coordinates</Badge>
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
      <FitBounds stations={validStations} />

      {/* Route lines */}
      {(viewMode === "all" || viewMode === "routes") &&
        uniqueRoutes.map((route) => (
          <Polyline
            key={route.id}
            positions={[
              [
                route.departureStation.latitude,
                route.departureStation.longitude,
              ],
              [route.arrivalStation.latitude, route.arrivalStation.longitude],
            ]}
            color={isDark ? "#4dabf7" : "#1971c2"}
            weight={2}
            opacity={0.7}
            dashArray="5, 10"
          />
        ))}

      {/* Station markers */}
      {(viewMode === "all" || viewMode === "stations") &&
        validStations.map((station) => (
          <Marker
            key={station.id}
            position={[station.latitude, station.longitude]}
            icon={stationIcon}
            eventHandlers={{
              click: () => onStationClick(station.id),
            }}
          >
            <Popup>
              <div style={{ minWidth: 180 }}>
                <Text fw={600} size="sm">
                  {station.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {station.city}, {station.country}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  Code: {station.code}
                </Text>
                {station.platforms && (
                  <Text size="xs" c="dimmed">
                    Platforms: {station.platforms}
                  </Text>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
};

export default AdminTopologyBrowser;
