import { Button } from "@alepha/ui/components/ui/button";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { Circle, Monitor, Plug, Smartphone } from "lucide-react";
import { useState } from "react";
import type {
  OAuthConnection,
  SessionController,
} from "@/api/controllers/SessionController.ts";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MyConnectionsProps {
  connections: OAuthConnection[];
}

/**
 * "Connected apps" — OAuth/MCP clients (Claude, etc.) connected to the
 * account. Each row is a client-tagged session; revoking it cuts that
 * client's access.
 */
const MyConnections = (props: MyConnectionsProps) => {
  const dt = useInject(DateTimeProvider);
  const sessionApi = useClient<SessionController>();
  const [connections, setConnections] = useState<OAuthConnection[]>(
    props.connections,
  );

  const revoke = async (id: string) => {
    await sessionApi.revokeSession({ params: { sessionId: id } });
    setConnections((prev) => prev.filter((c) => c.id !== id));
  };

  const isLive = (connection: OAuthConnection): boolean => {
    if (!connection.lastUsedAt) return false;
    const used = new Date(connection.lastUsedAt).getTime();
    return Number.isFinite(used) && dt.nowMillis() - used < RECENT_WINDOW_MS;
  };

  return (
    <div className="flex w-full flex-col gap-2 p-2">
      <div className="p-2">
        <span className="text-xs text-muted-foreground">
          Apps and AI assistants connected to your account over MCP via OAuth.
          Revoke a connection to cut its access — it will need to authorize
          again.
        </span>
      </div>

      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card p-6 text-center">
          <Plug className="size-5 text-muted-foreground" />
          <span className="text-sm">No connected apps yet.</span>
          <span className="text-xs text-muted-foreground">
            Add this server in an MCP client (e.g. Claude) to connect:
            <br />
            <code className="font-mono">https://lore.alepha.dev/mcp</code>
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3 shadow-sm"
            >
              <Circle
                className={`size-3 ${
                  isLive(connection)
                    ? "fill-green-500 text-green-500"
                    : "fill-muted-foreground text-muted-foreground"
                }`}
              />
              <div className="flex items-center justify-center">
                {connection.userAgent?.device === "MOBILE" ? (
                  <Smartphone className="size-4" />
                ) : (
                  <Monitor className="size-4" />
                )}
              </div>
              <div className="flex flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {connection.clientName}
                  </span>
                  {connection.current && (
                    <span className="text-xs text-muted-foreground">
                      this session
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {connection.lastUsedAt
                    ? `Last used ${dt.of(connection.lastUsedAt).fromNow()}`
                    : "Never used"}
                  {connection.ip ? ` · ${connection.ip}` : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600"
                onClick={() => revoke(connection.id)}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyConnections;
