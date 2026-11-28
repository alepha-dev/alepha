import { Badge, Button, Card, CardContent, Switch, TimeAgo } from "@alepha/ui";
import type { HostController } from "@lore/core/api";
import { type I18n, currentHostAtom } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AgentHostController } from "../../../../api/controllers/AgentHostController.ts";
import BayAgentLimits from "./BayAgentLimits.tsx";

export interface BayAgentHostProps {
  /** Whether the viewer may change the host (`host:update`). */
  canUpdate: boolean;
}

/**
 * The host as an **Agent host** (#Q3985): the switch that makes it run agent
 * CLI jobs (it needs jobs allowed), the last capability check (available or
 * not, with the agent's message), how many jobs it runs (#Q4249) and of how
 * many per lane (#Q4525), those limits, editable (#Q4543), and a link
 * to the Tools section (#Q4254), which lists what the jobs user has. Lore
 * never sees a credential; the operator installs and signs in the tools by
 * hand for Bay's jobs user.
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
                  loading={check.loading}
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
            {/* How many jobs it runs, of how many it may (#Q4249): one
                limit, or one per lane on a host that has two (#Q4525). */}
            <span
              className="text-muted-foreground text-xs"
              data-testid="bay-agent-running"
            >
              {host.jobsMaxReadJobs == null
                ? tr("hosts.agent.running", {
                    args: [
                      String(host.jobsRunning ?? 0),
                      String(host.jobsMaxJobs ?? 1),
                    ],
                  })
                : tr("hosts.agent.running.lanes", {
                    args: [
                      String(host.jobsRunning ?? 0),
                      String(host.jobsMaxJobs ?? 1),
                      String(host.jobsMaxReadJobs),
                    ],
                  })}
            </span>
            {/* The two limits, editable by a member who may update the
                host, written to Bay's own config (#Q4543). */}
            <BayAgentLimits canUpdate={canUpdate} />
            {/* The tools themselves are the Tools section's (#Q4254). */}
            {host.jobsTools &&
              !host.jobsTools.some(
                (tool) => tool.kind === "agent" && tool.found && !tool.error,
              ) && (
                <span className="text-danger text-xs">
                  {tr("hosts.agent.tools.noAgent")}
                </span>
              )}
            <a
              href="#host-tools"
              className="text-muted-foreground text-xs underline"
              data-testid="bay-agent-tools-link"
            >
              {tr("hosts.agent.tools.link")}
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BayAgentHost;
