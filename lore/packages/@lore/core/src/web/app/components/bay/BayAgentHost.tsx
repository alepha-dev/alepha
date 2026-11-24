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
 * The host as an **Agent host** (#Q3985): the switch that makes it run agent
 * CLI jobs (it needs jobs allowed), the last capability check (available or
 * not, with the agent's message), and what the jobs user has (#Q4220): each
 * agent CLI, git, gh and lore, with its version, as the inventory reports.
 * Lore never sees a credential; the operator installs and signs in the
 * tools by hand for Bay's jobs user.
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
            {/* How many jobs it runs, of how many it may (#Q4249). */}
            <span
              className="text-muted-foreground text-xs"
              data-testid="bay-agent-running"
            >
              {tr("hosts.agent.running", {
                args: [
                  String(host.jobsRunning ?? 0),
                  String(host.jobsMaxJobs ?? 1),
                ],
              })}
            </span>
            {host.jobsTools && (
              <ul
                className="text-muted-foreground flex flex-col gap-0.5 text-xs"
                data-testid="bay-agent-tools"
              >
                {host.jobsTools.map((tool) => (
                  <li
                    key={tool.name}
                    className="flex gap-2"
                    data-testid={`bay-agent-tool-${tool.name}`}
                  >
                    <span className="text-foreground font-mono">
                      {tool.name}
                    </span>
                    <span>
                      {!tool.found
                        ? tr("hosts.agent.tool.missing")
                        : (tool.error ?? tool.version ?? "")}
                    </span>
                  </li>
                ))}
                {!host.jobsTools.some(
                  (tool) => tool.kind === "agent" && tool.found && !tool.error,
                ) && (
                  <li className="text-danger">
                    {tr("hosts.agent.tools.noAgent")}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BayAgentHost;
