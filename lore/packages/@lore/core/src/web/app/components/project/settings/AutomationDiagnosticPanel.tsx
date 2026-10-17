import { Button, Card, CardContent } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AutomationDiagnosticController } from "../../../../../api/controllers/AutomationDiagnosticController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { hasCapability } from "../../../services/projectCapabilities.ts";
import { canInProject } from "../../../services/projectRank.ts";

export interface AutomationDiagnosticPanelProps {
  /**
   * Drawn on General rather than on its own tab: only while Work is off,
   * when the Quests section and its Automations tab leave the sidebar, and
   * only once the project has a rule to show.
   */
  fallback?: boolean;
}

/**
 * Owner-only rule metadata, readable while Work or its `automations` option
 * is off (#Q2040). Its home is Quests > Automations
 * (`projectSettingsAutomations`, #Q2686); General shows it only as the
 * `fallback` above. Only the owner requests metadata.
 */
const AutomationDiagnosticPanel = (props: AutomationDiagnosticPanelProps) => {
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const owner = canInProject(project, "capability:manage");
  const shown = owner && !(props.fallback && hasCapability(project, "work"));
  const [offset, setOffset] = useState(0);
  const stateLabels = {
    active: tr("automation.state.active"),
    paused: tr("automation.state.paused"),
    broken: tr("automation.state.broken"),
  };
  const api = useClient<AutomationDiagnosticController>();
  const read = useQuery(
    {
      key: ["automation-diagnostics", project?.id, offset],
      enabled: shown,
      handler: () =>
        api.getAutomationDiagnostics({
          params: { projectId: project!.id },
          query: { offset },
        }),
    },
    [project?.id, offset],
  );
  if (!shown) return null;
  const empty = read.data?.items.length === 0;
  if (props.fallback && (!read.data || (empty && offset === 0))) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-medium">
          {tr("automation.diagnostics.title")}
        </h2>
        <p className="text-muted-foreground text-xs">
          {tr("automation.diagnostics.description")}
        </p>
        {empty && (
          <p className="text-sm">{tr("automation.diagnostics.empty")}</p>
        )}
        {read.data?.items.map((rule) => (
          <div
            key={rule.id}
            className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"
          >
            <span>{rule.title}</span>
            <span>
              {!rule.enabled
                ? tr("automation.state.disabled")
                : stateLabels[rule.health]}
            </span>
            {rule.reason && (
              <p className="text-muted-foreground w-full text-xs">
                {rule.reason}
              </p>
            )}
          </div>
        ))}
        {read.data?.hasMore && (
          <p className="text-muted-foreground text-xs">
            {tr("automation.diagnostics.more")}
          </p>
        )}
        {/* A single page has nowhere to go: no pager at all. */}
        {(offset > 0 || read.data?.hasMore) && (
          <div className="flex gap-2">
            <Button
              disabled={read.loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              {tr("automation.previous")}
            </Button>
            <Button
              disabled={read.loading || !read.data?.hasMore}
              onClick={() => setOffset(offset + 50)}
            >
              {tr("automation.next")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AutomationDiagnosticPanel;
