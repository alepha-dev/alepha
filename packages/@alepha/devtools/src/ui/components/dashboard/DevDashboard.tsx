import { devMetadataSchema } from "@alepha/devtools";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { useInject } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import {
  Atom,
  Cable,
  Clock,
  Cpu,
  Database,
  FileText,
  Layers,
  Plug,
  Radio,
  RefreshCw,
  Route,
  Server,
  Settings,
  Variable,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface LogEntry {
  level: string;
  message: string;
  module: string;
  service: string;
  data?: any;
  timestamp: number;
}

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const levelClass: Record<string, string> = {
  ERROR: "text-red-500 bg-red-500/10",
  WARN: "text-yellow-600 bg-yellow-500/10",
  INFO: "text-blue-500 bg-blue-500/10",
  DEBUG: "text-muted-foreground bg-muted",
  TRACE: "text-muted-foreground bg-muted",
};

const eventTypeClass: Record<string, string> = {
  http: "text-teal-500 bg-teal-500/10",
  db: "text-violet-500 bg-violet-500/10",
  error: "text-red-500 bg-red-500/10",
};

const detectEventType = (data: any): string | undefined => {
  if (!data || typeof data !== "object") return undefined;
  if (data.status && data.method && data.path && data.duration) return "http";
  if (data.type === "db:query") return "db";
  return undefined;
};

const formatEvent = (entry: LogEntry): string => {
  const data = entry.data;
  const eventType = detectEventType(data);
  if (eventType === "http") {
    return `${data.method} ${data.path} → ${data.status} (${data.duration}ms)`;
  }
  if (eventType === "db") {
    return `${data.operation} (${Math.round(data.duration)}ms)`;
  }
  return entry.message;
};

export const DevDashboard = () => {
  const http = useInject(HttpClient);
  const router = useRouter();
  const [metadata, setMetadata] = useState<any>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [reloading, setReloading] = useState(false);

  const fetchData = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const [metaRes, logsRes, eventsRes] = await Promise.all([
        http.fetch("/__devtools/api/metadata", {
          schema: { response: devMetadataSchema },
        }),
        http.fetch("/__devtools/api/logs?limit=10&level=DEBUG"),
        http.fetch("/__devtools/api/logs?limit=20&type=http,db"),
      ]);
      setMetadata(metaRes.data);
      setLogs((logsRes.data as any)?.logs ?? []);
      setEvents((eventsRes.data as any)?.logs ?? []);
    } catch {
      // silently fail
    }
  }, [http]);

  const handleReload = useCallback(async () => {
    setReloading(true);
    try {
      await http.fetch("/__devtools/api/reload", { method: "POST" });
      setTimeout(() => {
        fetchData();
        setReloading(false);
      }, 1000);
    } catch {
      setReloading(false);
    }
  }, [http, fetchData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const system = metadata?.system;

  const primitiveStats = useMemo(() => {
    if (!metadata) return [];
    return [
      { label: "Actions", count: metadata.actions?.length ?? 0, icon: Zap },
      { label: "Pages", count: metadata.pages?.length ?? 0, icon: FileText },
      {
        label: "Entities",
        count: metadata.entities?.length ?? 0,
        icon: Database,
      },
      { label: "Queues", count: metadata.queues?.length ?? 0, icon: Layers },
      { label: "Topics", count: metadata.topics?.length ?? 0, icon: Radio },
      { label: "Caches", count: metadata.caches?.length ?? 0, icon: Route },
      {
        label: "Providers",
        count: metadata.providers?.length ?? 0,
        icon: Plug,
      },
      { label: "Atoms", count: metadata.atoms?.length ?? 0, icon: Atom },
      { label: "Env Vars", count: metadata.envs?.length ?? 0, icon: Variable },
    ];
  }, [metadata]);

  return (
    <div className="flex w-full flex-1 flex-col overflow-auto p-6">
      <div className="flex flex-col gap-6">
        {/* App Stats */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              System
            </h2>
            <Button
              size="sm"
              variant="ghost"
              disabled={reloading}
              onClick={handleReload}
            >
              <RefreshCw
                className={`size-3.5 ${reloading ? "animate-spin" : ""}`}
              />
              Reload
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {system && (
              <>
                <StatCard
                  icon={Server}
                  label="Runtime"
                  value={system.runtime === "bun" ? "Bun" : "Node.js"}
                />
                <StatCard
                  icon={Cable}
                  label="Version"
                  value={system.nodeVersion}
                />
                <StatCard icon={Settings} label="Mode" value={system.mode} />
                <StatCard
                  icon={Route}
                  label="Port"
                  value={String(system.port)}
                />
                <StatCard
                  icon={Clock}
                  label="Uptime"
                  value={formatUptime(system.uptime)}
                />
                <StatCard
                  icon={Cpu}
                  label="Memory"
                  value={formatBytes(system.memoryUsage)}
                />
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          {/* Recent Events */}
          <Card className="p-4 md:col-span-7">
            <h3 className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wider">
              Recent Events
            </h3>
            <div className="h-[280px] overflow-auto">
              <div className="flex flex-col gap-1">
                {events.length === 0 && (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    No events yet
                  </p>
                )}
                {events.map((entry, i) => {
                  const eventType = detectEventType(entry.data) ?? "log";
                  return (
                    <div
                      key={`${entry.timestamp}-${i}`}
                      className="hover:bg-muted/50 flex items-center gap-2 rounded px-2 py-1 transition-colors"
                    >
                      <span className="text-muted-foreground w-14 shrink-0 font-mono text-xs">
                        {new Date(entry.timestamp).toLocaleTimeString("en", {
                          hour12: false,
                        })}
                      </span>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] ${eventTypeClass[eventType] ?? ""}`}
                      >
                        {eventType === "http"
                          ? "HTTP"
                          : eventType === "db"
                            ? "DB"
                            : "LOG"}
                      </Badge>
                      <span className="flex-1 truncate font-mono text-xs">
                        {formatEvent(entry)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Recent Logs */}
          <Card className="p-4 md:col-span-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                Recent Logs
              </h3>
              <button
                type="button"
                className="text-blue-500 text-xs hover:underline"
                onClick={() => router.push("/logs")}
              >
                View all
              </button>
            </div>
            <div className="h-[280px] overflow-auto">
              <div className="flex flex-col gap-1">
                {logs.length === 0 && (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    No logs yet
                  </p>
                )}
                {logs.map((entry, i) => (
                  <div
                    key={`${entry.timestamp}-${i}`}
                    className="flex items-center gap-2 rounded px-2 py-1"
                  >
                    <span
                      className={`w-14 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold ${levelClass[entry.level] ?? ""}`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                      {entry.module}
                    </span>
                    <span className="flex-1 truncate font-mono text-xs">
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Primitives Stats */}
        <div>
          <h2 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wider">
            Primitives
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {primitiveStats.map((stat) => (
              <Card key={stat.label} className="p-3">
                <div className="flex items-center gap-3">
                  <stat.icon className="size-4 opacity-50" />
                  <div className="flex-1">
                    <p className="text-muted-foreground text-xs">
                      {stat.label}
                    </p>
                    <p className="text-lg font-bold leading-tight">
                      {stat.count}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

interface StatCardProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

const StatCard = (props: StatCardProps) => {
  const Icon = props.icon;
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 opacity-40" />
        <div>
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
            {props.label}
          </p>
          <p className="font-mono text-sm font-semibold">{props.value}</p>
        </div>
      </div>
    </Card>
  );
};

export default DevDashboard;
