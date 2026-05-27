import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { Search, X } from "lucide-react";
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

const LEVEL_CLASS: Record<string, string> = {
  ERROR: "text-red-500 bg-red-500/10",
  WARN: "text-yellow-600 bg-yellow-500/10",
  INFO: "text-blue-500 bg-blue-500/10",
  DEBUG: "text-muted-foreground bg-muted",
  TRACE: "text-muted-foreground bg-muted",
};

const TYPE_CLASS: Record<string, string> = {
  http: "text-teal-500 bg-teal-500/10",
  db: "text-violet-500 bg-violet-500/10",
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

interface ColumnDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
}

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

  const [level, setLevel] = useState("DEBUG");
  const [typeFilter, setTypeFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [timeRange, setTimeRange] = useState("0");

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    for (const col of COLUMNS) {
      widths[col.key] = col.defaultWidth;
    }
    return widths;
  });

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
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filters bar */}
      <div className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[level]}
            onValueChange={(v) => {
              const next = v[0];
              if (next) setLevel(next);
            }}
          >
            <ToggleGroupItem value="TRACE">TRACE</ToggleGroupItem>
            <ToggleGroupItem value="DEBUG">DEBUG</ToggleGroupItem>
            <ToggleGroupItem value="INFO">INFO</ToggleGroupItem>
            <ToggleGroupItem value="WARN">WARN</ToggleGroupItem>
            <ToggleGroupItem value="ERROR">ERROR</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={typeFilter || "all"}
            onValueChange={(v) => setTypeFilter(!v || v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="db">DB Query</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={moduleFilter || "all"}
            onValueChange={(v) => setModuleFilter(!v || v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={(v) => v && setTimeRange(v)}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative max-w-[300px] flex-1 min-w-[150px]">
            <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search..."
              className="h-8 pl-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
          <Badge variant="secondary">{total} total</Badge>
        </div>
      </div>

      {/* Main area: table + detail */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Table header */}
          <div className="border-border flex shrink-0 border-b">
            {COLUMNS.map((col) => (
              <div
                key={col.key}
                className="relative flex items-center px-2 py-1 select-none"
                style={{
                  width: colWidths[col.key],
                  minWidth: col.minWidth,
                  flexShrink: 0,
                }}
              >
                <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                  {col.label}
                </span>
                <div
                  onMouseDown={(e) => startResize(col.key, e)}
                  className="hover:bg-border absolute right-0 top-0 bottom-0 w-1 cursor-col-resize"
                />
              </div>
            ))}
            <div className="flex flex-1 items-center px-2 py-1">
              <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                Message
              </span>
            </div>
          </div>

          {/* Table body */}
          <div className="flex-1 overflow-auto">
            {logs.length === 0 && (
              <div className="text-muted-foreground flex items-center justify-center py-8">
                <p className="text-sm">No logs match the current filters</p>
              </div>
            )}
            {logs.map((entry, i) => {
              const isSelected = selectedIndex === i;
              const eventType = detectEventType(entry.data);

              return (
                <button
                  type="button"
                  key={`${entry.timestamp}-${i}`}
                  onClick={() => setSelectedIndex(isSelected ? null : i)}
                  className={`border-border/20 flex w-full border-b text-left transition-colors ${
                    isSelected ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <div
                    className="flex items-center overflow-hidden px-2 py-1"
                    style={{ width: colWidths.time, flexShrink: 0 }}
                  >
                    <span className="text-muted-foreground truncate font-mono text-[11px]">
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>

                  <div
                    className="flex items-center overflow-hidden px-2 py-1"
                    style={{ width: colWidths.level, flexShrink: 0 }}
                  >
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-bold ${LEVEL_CLASS[entry.level] ?? "bg-muted"}`}
                    >
                      {entry.level}
                    </span>
                  </div>

                  <div
                    className="flex items-center overflow-hidden px-2 py-1"
                    style={{ width: colWidths.type, flexShrink: 0 }}
                  >
                    {eventType && (
                      <span
                        className={`rounded px-1 py-0.5 text-[10px] font-bold ${TYPE_CLASS[eventType] ?? "bg-muted"}`}
                      >
                        {eventType === "http" ? "HTTP" : "DB"}
                      </span>
                    )}
                  </div>

                  <div
                    className="flex items-center overflow-hidden px-2 py-1"
                    style={{ width: colWidths.context, flexShrink: 0 }}
                  >
                    {entry.context && (
                      <span className="text-muted-foreground truncate font-mono text-[11px]">
                        {entry.context}
                      </span>
                    )}
                  </div>

                  <div
                    className="flex items-center overflow-hidden px-2 py-1"
                    style={{ width: colWidths.module, flexShrink: 0 }}
                  >
                    <span className="text-muted-foreground truncate text-[11px]">
                      {entry.module}
                    </span>
                  </div>

                  <div className="flex flex-1 items-center overflow-hidden px-2 py-1">
                    <span className="truncate font-mono text-[11px]">
                      {entry.message}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selectedLog && (
          <div className="border-border flex w-[400px] shrink-0 flex-col overflow-hidden border-l">
            <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-2">
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                Log Detail
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIndex(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${LEVEL_CLASS[selectedLog.level] ?? "bg-muted"}`}
                  >
                    {selectedLog.level}
                  </span>
                  {detectEventType(selectedLog.data) && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                        TYPE_CLASS[detectEventType(selectedLog.data)!] ??
                        "bg-muted"
                      }`}
                    >
                      {detectEventType(selectedLog.data) === "http"
                        ? "HTTP"
                        : "DB"}
                    </span>
                  )}
                  {selectedLog.module && (
                    <Badge
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => setModuleFilter(selectedLog.module)}
                    >
                      {selectedLog.module}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-col">
                  <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                    Timestamp
                  </p>
                  <p className="font-mono text-xs">
                    {new Date(selectedLog.timestamp).toISOString()}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatRelative(selectedLog.timestamp)}
                  </p>
                </div>

                {selectedLog.context && (
                  <div className="flex flex-col">
                    <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                      Context
                    </p>
                    <p className="font-mono text-xs">{selectedLog.context}</p>
                  </div>
                )}

                <div className="flex flex-col">
                  <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                    Message
                  </p>
                  <p className="whitespace-pre-wrap font-mono text-xs">
                    {selectedLog.message}
                  </p>
                </div>

                {selectedLog.service && (
                  <div className="flex flex-col">
                    <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                      Service
                    </p>
                    <p className="font-mono text-xs">{selectedLog.service}</p>
                  </div>
                )}

                {selectedLog.data && (
                  <div className="flex flex-col">
                    <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                      Data
                    </p>
                    <pre className="bg-muted overflow-auto rounded p-2 text-xs">
                      {JSON.stringify(selectedLog.data, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.stack && (
                  <div className="flex flex-col">
                    <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
                      Stack Trace
                    </p>
                    <pre className="bg-muted max-h-[300px] overflow-auto rounded p-2 text-[11px]">
                      {selectedLog.stack}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DevLogs;
