import { Badge, Button, Card, CardContent, Switch, TimeAgo } from "@alepha/ui";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AgentHostController } from "../../../../api/controllers/AgentHostController.ts";
import type { HostController } from "../../../../api/controllers/HostController.ts";
import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface BayAgentHostProps {
  /** Whether the viewer may change the host (`host:update`). */
  canUpdate: boolean;
}

/**
 * The host as an **Agent host** (#Q3985): the switch that makes it run
 * Claude Code jobs (it needs jobs allowed), and the last capability check:
 * available or not, the CLI's message, its version, the model and the kind
 * of credential. Lore never sees the credential; the operator sets Claude
 * Code up by hand for Bay's jobs user.
 */
const BayAgentHost = ({ canUpdate }: BayAgentHostProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<HostController>();
  const agentApi = useClient<AgentHostController>();
  const [host, setHost] = useStore(currentHostAtom);

  const reread = async () => {
    if (!host) return;
    const fresh = await api.getHost({ params: { hostId: host.id } });
    setHost({ ...fresh, projects: host.projects });
  };

  const toggle = useAction<[on: boolean], void>(
    {
      handler: async (_ctx, on) => {
        if (!host) return;
        const updated = await api.updateHost({
          params: { hostId: host.id },
          body: { agentHost: on },
        });
        setHost({ ...updated, projects: host.projects });
      },
    },
    [api, host],
  );

  const check = useAction<[], void>(
    {
      handler: async () => {
        if (!host) return;
        await agentApi.checkAgentHost({ params: { hostId: host.id } });
        await reread();
      },
    },
    [agentApi, host],
  );

  if (!host || host.type !== "bay") return null;
  const busy = toggle.loading || check.loading;

  return (
    <Card data-testid="bay-agent-host">
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span>{tr("hosts.agent.switch")}</span>
            <span className="text-muted-foreground text-xs">
              {host.jobsAllowed
                ? tr("hosts.agent.switch.description")
                : tr("hosts.agent.switch.needsJobs")}
            </span>
          </span>
          <Switch
            checked={host.agentHost}
            disabled={
              !canUpdate || busy || (!host.agentHost && !host.jobsAllowed)
            }
            onCheckedChange={(value) => void toggle.run(value)}
            aria-label={tr("hosts.agent.switch")}
            data-testid="bay-agent-host-switch"
          />
        </div>
        {host.agentHost && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  host.agentStatus === "unavailable"
                    ? "destructive"
                    : host.agentStatus === "available"
                      ? "secondary"
                      : "outline"
                }
                data-testid="bay-agent-status"
              >
                {host.agentStatus === "available"
                  ? tr("hosts.agent.status.available")
                  : host.agentStatus === "unavailable"
                    ? tr("hosts.agent.status.unavailable")
                    : host.agentStatus === "checking"
                      ? tr("hosts.agent.status.checking")
                      : tr("hosts.agent.status.unknown")}
              </Badge>
              {host.agentCheckedAt && (
                <span className="text-muted-foreground text-xs">
                  <TimeAgo value={host.agentCheckedAt} />
                </span>
              )}
              {canUpdate && (
                <Button
                  variant="outlined"
                  size="sm"
                  disabled={busy || host.agentStatus === "checking"}
                  onClick={() => void check.run()}
                  data-testid="bay-agent-check"
                >
                  {tr("hosts.agent.check")}
                </Button>
              )}
            </div>
            {host.agentError && (
              <span className="text-muted-foreground font-mono text-xs">
                {host.agentError}
              </span>
            )}
            {(host.agentCliVersion || host.agentModel) && (
              <span className="text-muted-foreground text-xs">
                {[
                  host.agentCliVersion
                    ? `Claude Code ${host.agentCliVersion}`
                    : undefined,
                  host.agentModel,
                  host.agentCredential === "oauth"
                    ? tr("hosts.agent.credential.oauth")
                    : host.agentCredential === "api_key"
                      ? tr("hosts.agent.credential.api_key")
                      : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BayAgentHost;
