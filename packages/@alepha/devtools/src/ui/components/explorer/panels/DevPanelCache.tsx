import { Badge } from "@alepha/ui/components/ui/badge";
import { Card } from "@alepha/ui/components/ui/card";

const formatTtl = (seconds?: number): string => {
  if (!seconds) return "No TTL";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

interface DevPanelCacheProps {
  cache: any;
}

export const DevPanelCache = (props: DevPanelCacheProps) => {
  const cache = props.cache;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 text-lg font-semibold">{cache.name}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Cache</Badge>
        {cache.provider && <Badge variant="outline">{cache.provider}</Badge>}
        {cache.disabled && <Badge variant="destructive">Disabled</Badge>}
      </div>

      <Card className="p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">TTL</span>
            <span className="font-mono text-sm">{formatTtl(cache.ttl)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Provider</span>
            <span className="font-mono text-sm">
              {cache.provider ?? "default"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Status</span>
            <Badge variant={cache.disabled ? "destructive" : "default"}>
              {cache.disabled ? "Disabled" : "Active"}
            </Badge>
          </div>
        </div>
      </Card>
    </div>
  );
};
