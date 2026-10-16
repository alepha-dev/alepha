import { Button } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationVariableResource } from "../../../../../api/schemas/automationVariableResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";
import AutomationVariableEditor from "./AutomationVariableEditor.tsx";

export interface AutomationVariablesPageProps {
  variableKey?: string;
}
const AutomationVariablesPage = (props: AutomationVariablesPageProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const router = useRouter<AutomationRouter>();
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
  return (
    <div className="flex max-w-3xl flex-col gap-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {tr("automation.variables.title")}
        </h1>
        <Button
          variant="minimal"
          onClick={() =>
            router.push("projectAutomations", {
              params: { projectSlug: project!.slug },
            })
          }
        >
          {tr("automation.gallery.back")}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        {tr("automation.variables.description")}
      </p>
      {manage && (
        <Button
          variant="outlined"
          className="self-start"
          disabled={busy}
          onClick={() => {
            setCreating(true);
            setSelected(undefined);
          }}
        >
          {tr("automation.variables.create")}
        </Button>
      )}
      {read.data?.items.map((variable) => (
        <div
          key={variable.id}
          className="border-border flex items-center justify-between border-b py-2"
        >
          <Button
            variant="link"
            disabled={busy}
            onClick={() => {
              setSelected(variable);
              setCreating(false);
            }}
          >
            {variable.key}
          </Button>
          <span className="text-muted-foreground text-sm">
            {kindLabels[variable.kind]} / v{variable.version}
          </span>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="minimal"
          disabled={busy || read.loading || !offset}
          onClick={() => setOffset((value) => Math.max(0, value - 50))}
        >
          {tr("automation.previous")}
        </Button>
        <Button
          variant="minimal"
          disabled={busy || read.loading || !read.data?.hasMore}
          onClick={() => setOffset((value) => value + 50)}
        >
          {tr("automation.next")}
        </Button>
      </div>
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
    </div>
  );
};
export default AutomationVariablesPage;
