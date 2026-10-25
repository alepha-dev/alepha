import { Button } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationVariableResource } from "../../../../../api/schemas/automationVariableResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";
import AutomationPage from "./AutomationPage.tsx";
import AutomationVariableEditor from "./AutomationVariableEditor.tsx";

export interface AutomationVariablesPageProps {
  variableKey?: string;
}
const AutomationVariablesPage = (props: AutomationVariablesPageProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const { tr } = useI18n<I18n, "en">();
  const kindLabels = {
    text: tr("automation.variables.kind.text"),
    number: tr("automation.variables.kind.number"),
    member: tr("automation.variables.kind.member"),
    folio: tr("automation.variables.kind.folio"),
    release: tr("automation.variables.kind.release"),
    channel: tr("automation.variables.kind.channel"),
  };

  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selection, setSelected] = useState<AutomationVariableResource>();
  const [creating, setCreating] = useState(false);
  const read = useQuery(
    {
      key: ["automation-variables", project?.id, offset, props.variableKey],
      enabled: !!project,
      handler: ({ signal }) =>
        api.listAutomationVariables(
          {
            params: { projectId: project!.id },
            query: {
              offset,
              limit: 50,
              ...(props.variableKey ? { key: props.variableKey } : {}),
            },
          },
          { request: { signal } },
        ),
    },
    [project?.id, offset, props.variableKey],
  );
  const catalog = useQuery(
    {
      key: ["automation-catalog", project?.id],
      enabled: !!project,
      handler: ({ signal }) =>
        api.getAutomationCatalog(
          { params: { projectId: project!.id } },
          { request: { signal } },
        ),
    },
    [project?.id],
  );
  const selected =
    selection ??
    (props.variableKey
      ? read.data?.items.find((item) => item.key === props.variableKey)
      : undefined);
  const manage = !!project && canInProject(project, "automation:manage");
  const items = read.data?.items ?? [];
  return (
    <AutomationPage
      title={tr("automation.variables.title")}
      description={tr("automation.variables.description")}
      actions={
        manage && (
          <Button
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setSelected(undefined);
            }}
          >
            <Plus className="size-4" />
            {tr("automation.variables.create")}
          </Button>
        )
      }
    >
      {(creating || selected) && (
        <AutomationVariableEditor
          key={selected ? `${selected.id}:${selected.version}` : "new"}
          variable={selected}
          channels={
            catalog.data?.channels
              .filter((item) => item.available)
              .map((item) => item.key) ?? []
          }
          canManage={manage}
          onBusyChange={setBusy}
          onSaved={(deleted) => {
            setCreating(false);
            if (deleted) setSelected(undefined);
          }}
        />
      )}
      {read.data && !items.length && !offset ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          {tr("automation.variables.empty")}
        </div>
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-lg border">
          {items.map((variable) => (
            <li key={variable.id}>
              <button
                type="button"
                disabled={busy}
                aria-current={selected?.id === variable.id || undefined}
                className="hover:bg-hover aria-[current]:bg-muted flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm"
                onClick={() => {
                  setSelected(variable);
                  setCreating(false);
                }}
              >
                <span className="font-mono">{variable.key}</span>
                <span className="text-muted-foreground text-xs">
                  {kindLabels[variable.kind]} · v{variable.version}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(offset > 0 || read.data?.hasMore) && (
        <div className="flex gap-2">
          <Button
            variant="minimal"
            size="sm"
            disabled={busy || read.loading || !offset}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            {tr("automation.previous")}
          </Button>
          <Button
            variant="minimal"
            size="sm"
            disabled={busy || read.loading || !read.data?.hasMore}
            onClick={() => setOffset((value) => value + 50)}
          >
            {tr("automation.next")}
          </Button>
        </div>
      )}
    </AutomationPage>
  );
};
export default AutomationVariablesPage;
