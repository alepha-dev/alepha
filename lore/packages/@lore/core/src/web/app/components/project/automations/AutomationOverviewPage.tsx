import { Button, Card, CardContent } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AutomationDiagnosticController } from "../../../../../api/controllers/AutomationDiagnosticController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

const AutomationOverviewPage = () => {
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const [offset, setOffset] = useState(0);
  const stateLabels = {
    active: tr("automation.state.active"),
    paused: tr("automation.state.paused"),
    broken: tr("automation.state.broken"),
  };
  const api = useClient<AutomationDiagnosticController>();
  const read = useQuery(
    {
      key: ["automation-summaries", project?.id, offset],
      enabled: !!project,
      handler: () =>
        api.getAutomationSummaries({
          params: { projectId: project!.id },
          query: { offset },
        }),
    },
    [project?.id, offset],
  );
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">
        {tr("project.capability.work.option.automations.label")}
      </h1>
      {read.data?.items.length === 0 && (
        <p className="text-muted-foreground">
          {tr("automation.diagnostics.empty")}
        </p>
      )}
      {read.data?.items.map((rule) => (
        <Card key={rule.id}>
          <CardContent className="flex flex-col gap-2 p-4">
            <span className="font-medium">{rule.title}</span>
            <span>
              {!rule.enabled
                ? tr("automation.state.disabled")
                : stateLabels[rule.health]}
            </span>
            {rule.reason && (
              <p className="text-muted-foreground text-sm">{rule.reason}</p>
            )}
          </CardContent>
        </Card>
      ))}
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
    </div>
  );
};

export default AutomationOverviewPage;
