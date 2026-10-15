import { Button, Card, CardContent } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AutomationDiagnosticController } from "../../../../../api/controllers/AutomationDiagnosticController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";

/**
 * Remains in General when Work is off. Only the owner requests metadata.
 */
const AutomationDiagnosticPanel = () => {
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const owner = canInProject(project, "capability:manage");
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
      enabled: owner,
      handler: () =>
        api.getAutomationDiagnostics({
          params: { projectId: project!.id },
          query: { offset },
        }),
    },
    [project?.id, offset],
  );
  if (!owner) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-medium">
          {tr("automation.diagnostics.title")}
        </h2>
        <p className="text-muted-foreground text-xs">
          {tr("automation.diagnostics.description")}
        </p>
        {read.data?.items.length === 0 && (
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
      </CardContent>
    </Card>
  );
};

export default AutomationDiagnosticPanel;
