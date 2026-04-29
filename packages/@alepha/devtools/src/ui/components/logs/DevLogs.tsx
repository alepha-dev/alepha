import { Flex, JsonViewer, ui } from "@alepha/mantine";
import {
  Badge,
  CloseButton,
  Code,
  ScrollArea,
  SegmentedControl,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface LogEntry {
  level: string;
  message: string;
  module: string;
  service: string;
  context?: string;
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
  http: "teal",
  db: "violet",
};

const detectEventType = (data: any): string | undefined => {
  if (!data || typeof data !== "object") return undefined;
  if (data.status && data.method && data.path && data.duration) return "http";
  if (data.type === "db:query") return "db";
  return undefined;
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

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const pad3 = (n: number) => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n));

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
};

const formatRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
};

type ColumnDef = {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
};

const COLUMNS: ColumnDef[] = [
  { key: "time", label: "Time", defaultWidth: 105, minWidth: 60 },
  { key: "level", label: "Level", defaultWidth: 58, minWidth: 40 },
  { key: "type", label: "Type", defaultWidth: 60, minWidth: 40 },
  { key: "context", label: "Context", defaultWidth: 80, minWidth: 40 },
  { key: "module", label: "Module", defaultWidth: 100, minWidth: 50 },
];

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

  // Column widths
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    for (const col of COLUMNS) {
      widths[col.key] = col.defaultWidth;
    }
    return widths;
  });

  // Resize state
  const resizeRef = useRef<{
    colKey: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!resizeRef.current) return;
      const { colKey, startX, startWidth } = resizeRef.current;
      const col = COLUMNS.find((c) => c.key === colKey);
      const minW = col?.minWidth ?? 40;
      const newWidth = Math.max(minW, startWidth + (e.clientX - startX));
      setColWidths((prev) => ({ ...prev, [colKey]: newWidth }));
    };
    const onMouseUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startResize = (colKey: string, e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeRef.current = {
      colKey,
      startX: e.clientX,
      startWidth: colWidths[colKey],
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

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
      const newLogs = (res.data as any)?.logs ?? [];
      setLogs(newLogs);
      setTotal((res.data as any)?.total ?? 0);
      // Reset selection when logs change to avoid stale index
      setSelectedIndex(null);
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
      <Flex
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
              { value: "http", label: "HTTP" },
              { value: "db", label: "DB Query" },
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
      </Flex>

      {/* Main area: table + detail */}
      <Flex style={{ flex: 1, overflow: "hidden" }}>
        {/* Log table */}
        <Flex direction="column" style={{ flex: 1, overflow: "hidden" }}>
          {/* Table header */}
          <Flex
            style={{
              borderBottom: `1px solid ${ui.colors.border}`,
              flexShrink: 0,
            }}
          >
            {COLUMNS.map((col) => (
              <Flex
                key={col.key}
                align="center"
                px="xs"
                py={4}
                style={{
                  width: colWidths[col.key],
                  minWidth: col.minWidth,
                  flexShrink: 0,
                  position: "relative",
                  userSelect: "none",
                }}
              >
                <Text fz={10} c="dimmed" tt="uppercase" fw={600} lts={0.5}>
                  {col.label}
                </Text>
                <div
                  onMouseDown={(e) => startResize(col.key, e)}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    cursor: "col-resize",
                    background: "transparent",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      ui.colors.border;
                  }}
                  onMouseLeave={(e) => {
                    if (!resizeRef.current) {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }
                  }}
                />
              </Flex>
            ))}
            <Flex align="center" px="xs" py={4} style={{ flex: 1 }}>
              <Text fz={10} c="dimmed" tt="uppercase" fw={600} lts={0.5}>
                Message
              </Text>
            </Flex>
          </Flex>

          {/* Table body */}
          <ScrollArea style={{ flex: 1 }}>
            {logs.length === 0 && (
              <Flex align="center" justify="center" py="xl" c="dimmed">
                <Text fz="sm">No logs match the current filters</Text>
              </Flex>
            )}
            {logs.map((entry, i) => {
              const isSelected = selectedIndex === i;
              const eventType = detectEventType(entry.data);

              return (
                <Flex
                  key={`${entry.timestamp}-${i}`}
                  onClick={() => setSelectedIndex(isSelected ? null : i)}
                  style={{
                    borderBottom: `1px solid ${ui.colors.border}20`,
                    background: isSelected ? ui.colors.elevated : "transparent",
                    cursor: "pointer",
                    transition: "background 100ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background =
                        `${ui.colors.elevated}80`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }
                  }}
                >
                  {/* Time */}
                  <Flex
                    align="center"
                    px="xs"
                    py={4}
                    style={{
                      width: colWidths.time,
                      flexShrink: 0,
                      overflow: "hidden",
                    }}
                  >
                    <Text fz={11} ff="monospace" c="dimmed" truncate>
                      {formatTime(entry.timestamp)}
                    </Text>
                  </Flex>

                  {/* Level */}
                  <Flex
                    align="center"
                    px="xs"
                    py={4}
                    style={{
                      width: colWidths.level,
                      flexShrink: 0,
                      overflow: "hidden",
                    }}
                  >
                    <Badge
                      size="xs"
                      variant="light"
                      color={LEVEL_COLORS[entry.level] ?? "gray"}
                    >
                      {entry.level}
                    </Badge>
                  </Flex>

                  {/* Type */}
                  <Flex
                    align="center"
                    px="xs"
                    py={4}
                    style={{
                      width: colWidths.type,
                      flexShrink: 0,
                      overflow: "hidden",
                    }}
                  >
                    {eventType && (
                      <Badge
                        size="xs"
                        variant="dot"
                        color={TYPE_COLORS[eventType] ?? "gray"}
                      >
                        {eventType === "http"
                          ? "HTTP"
                          : eventType === "db"
                            ? "DB"
                            : eventType}
                      </Badge>
                    )}
                  </Flex>

                  {/* Context */}
                  <Flex
                    align="center"
                    px="xs"
                    py={4}
                    style={{
                      width: colWidths.context,
                      flexShrink: 0,
                      overflow: "hidden",
                    }}
                  >
                    {entry.context && (
                      <Text fz={11} ff="monospace" c="dimmed" truncate>
                        {entry.context}
                      </Text>
                    )}
                  </Flex>

                  {/* Module */}
                  <Flex
                    align="center"
                    px="xs"
                    py={4}
                    style={{
                      width: colWidths.module,
                      flexShrink: 0,
                      overflow: "hidden",
                    }}
                  >
                    <Text fz={11} c="dimmed" truncate>
                      {entry.module}
                    </Text>
                  </Flex>

                  {/* Message */}
                  <Flex
                    align="center"
                    px="xs"
                    py={4}
                    style={{ flex: 1, overflow: "hidden" }}
                  >
                    <Text fz={11} ff="monospace" truncate>
                      {entry.message}
                    </Text>
                  </Flex>
                </Flex>
              );
            })}
          </ScrollArea>
        </Flex>

        {/* Detail panel */}
        {selectedLog && (
          <Flex
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
              <Flex direction="column" gap="md">
                {/* Meta */}
                <Flex gap="xs" wrap="wrap">
                  <Badge
                    size="sm"
                    variant="light"
                    color={LEVEL_COLORS[selectedLog.level] ?? "gray"}
                  >
                    {selectedLog.level}
                  </Badge>
                  {detectEventType(selectedLog.data) && (
                    <Badge
                      size="sm"
                      variant="dot"
                      color={
                        TYPE_COLORS[detectEventType(selectedLog.data)!] ??
                        "gray"
                      }
                    >
                      {detectEventType(selectedLog.data) === "http"
                        ? "HTTP"
                        : "DB"}
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
                </Flex>

                {/* Timestamp */}
                <Flex direction="column">
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
                </Flex>

                {/* Context */}
                {selectedLog.context && (
                  <Flex direction="column">
                    <Text
                      fz={10}
                      c="dimmed"
                      tt="uppercase"
                      fw={600}
                      lts={0.5}
                      mb={4}
                    >
                      Context
                    </Text>
                    <Text fz="xs" ff="monospace">
                      {selectedLog.context}
                    </Text>
                  </Flex>
                )}

                {/* Message */}
                <Flex direction="column">
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
                </Flex>

                {/* Service */}
                {selectedLog.service && (
                  <Flex direction="column">
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
                  </Flex>
                )}

                {/* Structured data */}
                {selectedLog.data && (
                  <Flex direction="column">
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
                  </Flex>
                )}

                {/* Stack trace */}
                {selectedLog.stack && (
                  <Flex direction="column">
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
                  </Flex>
                )}
              </Flex>
            </ScrollArea>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};

export default DevLogs;
