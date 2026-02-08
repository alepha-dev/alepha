import { ui } from "@alepha/ui";
import { JsonViewer } from "@alepha/ui/json";
import {
  Badge,
  Box,
  CloseButton,
  Code,
  Flex,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";

interface LogEntry {
  level: string;
  message: string;
  module: string;
  service: string;
  data?: any;
  timestamp: number;
  stack?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "red",
  WARN: "yellow",
  INFO: "blue",
  DEBUG: "gray",
  TRACE: "dark",
};

const TYPE_COLORS: Record<string, string> = {
  "http:request": "teal",
  "db:query": "violet",
};

const TIME_RANGES = [
  { value: "300000", label: "Last 5m" },
  { value: "900000", label: "Last 15m" },
  { value: "1800000", label: "Last 30m" },
  { value: "3600000", label: "Last 1h" },
  { value: "21600000", label: "Last 6h" },
  { value: "86400000", label: "Last 24h" },
  { value: "0", label: "All time" },
];

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString("en", {
    hour12: false,
    fractionalSecondDigits: 3,
  });
};

const formatRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
};

export const DevLogs = () => {
  const http = useInject(HttpClient);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Filters
  const [level, setLevel] = useState("DEBUG");
  const [typeFilter, setTypeFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [timeRange, setTimeRange] = useState("0");

  // Available modules (collected from logs)
  const modules = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.module) set.add(log.module);
    }
    return Array.from(set).sort();
  }, [logs]);

  const fetchLogs = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const params = new URLSearchParams();
      if (level) params.set("level", level);
      if (typeFilter) params.set("type", typeFilter);
      if (moduleFilter) params.set("module", moduleFilter);
      if (search) params.set("search", search);
      if (timeRange !== "0") {
        params.set("since", String(Date.now() - Number(timeRange)));
      }
      params.set("limit", "500");

      const res = await http.fetch(`/__devtools/api/logs?${params.toString()}`);
      setLogs((res.data as any)?.logs ?? []);
      setTotal((res.data as any)?.total ?? 0);
    } catch {
      // silently fail
    }
  }, [http, level, typeFilter, moduleFilter, search, timeRange]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 10_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const selectedLog = selectedIndex !== null ? logs[selectedIndex] : null;

  return (
    <Flex style={{ flex: 1, overflow: "hidden" }} direction="column">
      {/* Filters bar */}
      <Box
        px="md"
        py="xs"
        style={{
          borderBottom: `1px solid ${ui.colors.border}`,
          flexShrink: 0,
        }}
      >
        <Flex gap="sm" align="center" wrap="wrap">
          <SegmentedControl
            size="xs"
            value={level}
            onChange={setLevel}
            data={["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]}
          />
          <Select
            size="xs"
            placeholder="Type"
            clearable
            value={typeFilter || null}
            onChange={(v) => setTypeFilter(v ?? "")}
            data={[
              { value: "http:request", label: "HTTP" },
              { value: "db:query", label: "DB Query" },
            ]}
            w={120}
          />
          <Select
            size="xs"
            placeholder="Module"
            clearable
            searchable
            value={moduleFilter || null}
            onChange={(v) => setModuleFilter(v ?? "")}
            data={modules}
            w={150}
          />
          <Select
            size="xs"
            value={timeRange}
            onChange={(v) => setTimeRange(v ?? "0")}
            data={TIME_RANGES}
            w={120}
          />
          <TextInput
            size="xs"
            placeholder="Search..."
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 150, maxWidth: 300 }}
          />
          <Badge variant="light" color="gray" size="sm">
            {total} total
          </Badge>
        </Flex>
      </Box>

      {/* Main area: table + detail */}
      <Flex style={{ flex: 1, overflow: "hidden" }}>
        {/* Log table */}
        <ScrollArea style={{ flex: 1 }}>
          <Box>
            {logs.length === 0 && (
              <Flex align="center" justify="center" py="xl" c="dimmed">
                <Text fz="sm">No logs match the current filters</Text>
              </Flex>
            )}
            {logs.map((entry, i) => {
              const isSelected = selectedIndex === i;
              const eventType = entry.data?.type;

              return (
                <UnstyledButton
                  key={`${entry.timestamp}-${i}`}
                  w="100%"
                  onClick={() => setSelectedIndex(isSelected ? null : i)}
                  style={{
                    borderBottom: `1px solid ${ui.colors.border}20`,
                    background: isSelected ? ui.colors.elevated : "transparent",
                  }}
                >
                  <Flex align="center" gap="xs" px="md" py={5}>
                    <Text
                      fz={11}
                      ff="monospace"
                      c="dimmed"
                      w={85}
                      style={{ flexShrink: 0 }}
                    >
                      {formatTime(entry.timestamp)}
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={LEVEL_COLORS[entry.level] ?? "gray"}
                      w={48}
                      style={{ flexShrink: 0 }}
                    >
                      {entry.level}
                    </Badge>
                    {eventType && (
                      <Badge
                        size="xs"
                        variant="dot"
                        color={TYPE_COLORS[eventType] ?? "gray"}
                        style={{ flexShrink: 0 }}
                      >
                        {eventType === "http:request"
                          ? "HTTP"
                          : eventType === "db:query"
                            ? "DB"
                            : eventType}
                      </Badge>
                    )}
                    <Text
                      fz={11}
                      c="dimmed"
                      w={80}
                      truncate
                      style={{ flexShrink: 0 }}
                    >
                      {entry.module}
                    </Text>
                    <Text fz={11} ff="monospace" truncate style={{ flex: 1 }}>
                      {entry.message}
                    </Text>
                  </Flex>
                </UnstyledButton>
              );
            })}
          </Box>
        </ScrollArea>

        {/* Detail panel */}
        {selectedLog && (
          <Box
            w={400}
            style={{
              borderLeft: `1px solid ${ui.colors.border}`,
              flexShrink: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Flex
              px="md"
              py="xs"
              align="center"
              justify="space-between"
              style={{
                borderBottom: `1px solid ${ui.colors.border}`,
                flexShrink: 0,
              }}
            >
              <Text fz="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
                Log Detail
              </Text>
              <CloseButton size="xs" onClick={() => setSelectedIndex(null)} />
            </Flex>
            <ScrollArea style={{ flex: 1 }} p="md">
              <Stack gap="md">
                {/* Meta */}
                <Group gap="xs" wrap="wrap">
                  <Badge
                    size="sm"
                    variant="light"
                    color={LEVEL_COLORS[selectedLog.level] ?? "gray"}
                  >
                    {selectedLog.level}
                  </Badge>
                  {selectedLog.data?.type && (
                    <Badge
                      size="sm"
                      variant="dot"
                      color={TYPE_COLORS[selectedLog.data.type] ?? "gray"}
                    >
                      {selectedLog.data.type}
                    </Badge>
                  )}
                  {selectedLog.module && (
                    <Badge
                      size="sm"
                      variant="outline"
                      color="gray"
                      style={{ cursor: "pointer" }}
                      onClick={() => setModuleFilter(selectedLog.module)}
                    >
                      {selectedLog.module}
                    </Badge>
                  )}
                </Group>

                {/* Timestamp */}
                <Box>
                  <Text
                    fz={10}
                    c="dimmed"
                    tt="uppercase"
                    fw={600}
                    lts={0.5}
                    mb={4}
                  >
                    Timestamp
                  </Text>
                  <Text fz="xs" ff="monospace">
                    {new Date(selectedLog.timestamp).toISOString()}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {formatRelative(selectedLog.timestamp)}
                  </Text>
                </Box>

                {/* Message */}
                <Box>
                  <Text
                    fz={10}
                    c="dimmed"
                    tt="uppercase"
                    fw={600}
                    lts={0.5}
                    mb={4}
                  >
                    Message
                  </Text>
                  <Text
                    fz="xs"
                    ff="monospace"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {selectedLog.message}
                  </Text>
                </Box>

                {/* Service */}
                {selectedLog.service && (
                  <Box>
                    <Text
                      fz={10}
                      c="dimmed"
                      tt="uppercase"
                      fw={600}
                      lts={0.5}
                      mb={4}
                    >
                      Service
                    </Text>
                    <Text fz="xs" ff="monospace">
                      {selectedLog.service}
                    </Text>
                  </Box>
                )}

                {/* Structured data */}
                {selectedLog.data && (
                  <Box>
                    <Text
                      fz={10}
                      c="dimmed"
                      tt="uppercase"
                      fw={600}
                      lts={0.5}
                      mb={4}
                    >
                      Data
                    </Text>
                    <JsonViewer data={selectedLog.data} maxDepth={4} />
                  </Box>
                )}

                {/* Stack trace */}
                {selectedLog.stack && (
                  <Box>
                    <Text
                      fz={10}
                      c="dimmed"
                      tt="uppercase"
                      fw={600}
                      lts={0.5}
                      mb={4}
                    >
                      Stack Trace
                    </Text>
                    <Code
                      block
                      style={{
                        fontSize: 11,
                        maxHeight: 300,
                        overflow: "auto",
                      }}
                    >
                      {selectedLog.stack}
                    </Code>
                  </Box>
                )}
              </Stack>
            </ScrollArea>
          </Box>
        )}
      </Flex>
    </Flex>
  );
};

export default DevLogs;
