import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";
import AutomationCreatedRule from "./AutomationCreatedRule.tsx";
import AutomationPresetForm from "./AutomationPresetForm.tsx";
import { useAutomationSetupChoices } from "./useAutomationSetupChoices.ts";

export interface AutomationPresetSetupProps {
  preset: AutomationPresetDescriptor;
  channels: Array<{ key: string; available: boolean }>;
  onCancel: () => void;
}

const AutomationPresetSetup = (props: AutomationPresetSetupProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const [created, setCreated] = useState<{
    rule: AutomationResource;
    labels: Record<string, string>;
  }>();
  const [variableOffset, setVariableOffset] = useState(0);
  const slots = Object.values(props.preset.slots);
  const members = useAutomationSetupChoices(
    "member",
    slots.some((slot) => slot.kind === "member"),
  );
  const folios = useAutomationSetupChoices(
    "folio",
    slots.some((slot) => slot.kind === "folio"),
  );
  const apps = useAutomationSetupChoices(
    "app",
    slots.some((slot) => slot.resource === "app"),
  );
  const variables = useQuery(
    {
      key: ["automation-variables", project?.id, variableOffset],
      enabled: !!project && slots.some((slot) => slot.bindable),
      handler: ({ signal }) =>
        api.listAutomationVariables(
          {
            params: { projectId: project!.id },
            query: { offset: variableOffset, limit: 50 },
          },
          { request: { signal } },
        ),
    },
    [project?.id, variableOffset],
  );
  if (!project) return null;
  if (created)
    return (
      <AutomationCreatedRule
        rule={created.rule}
        labels={created.labels}
        onChange={(rule) => setCreated({ ...created, rule })}
      />
    );
  const choices: Record<string, Array<{ value: string; label: string }>> = {};
  const navigation: NonNullable<
    Parameters<typeof AutomationPresetForm>[0]["choiceNavigation"]
  > = {};
  for (const [name, slot] of Object.entries(props.preset.slots)) {
    const source =
      slot.kind === "member"
        ? members
        : slot.kind === "folio"
          ? folios
          : slot.resource === "app"
            ? apps
            : undefined;
    if (source) {
      choices[name] = source.items;
      navigation[name] = source.navigation;
    }
    if (slot.kind === "channel")
      choices[name] = props.channels
        .filter(
          (channel) =>
            channel.available &&
            (!slot.values || slot.values.includes(channel.key)),
        )
        .map((channel) => ({
          value: channel.key,
          label: tr(`automation.channel.${channel.key}` as never, {
            default: channel.key,
          }),
        }));
  }
  // The generated form awaits these callbacks inside its managed handler.
  // Keeping rejection lets it retain fields and report a failed write once.
  return (
    <AutomationPresetForm
      preset={props.preset}
      choices={choices}
      choiceNavigation={navigation}
      variables={variables.data?.items ?? []}
      variableNavigation={{
        offset: variableOffset,
        hasMore: variables.data?.hasMore ?? false,
        loading: variables.loading,
        previous: () => setVariableOffset((value) => Math.max(0, value - 50)),
        next: () => setVariableOffset((value) => value + 50),
      }}
      canManageVariables={canInProject(project, "automation:manage")}
      onCreateShared={async (key, value) => {
        const result = await api.setAutomationVariable({
          params: { projectId: project.id, key },
          body: { value },
        });
        queries.invalidate(["automation-variables", project.id]);
        queries.invalidate(["automation-catalog", project.id]);
        return result.variable;
      }}
      onSubmit={async (values, bindings, labels) => {
        const result = await api.createAutomationFromPreset({
          params: { projectId: project.id },
          body: { key: props.preset.key, values, bindings },
        });
        queries.invalidate(["automations", project.id]);
        setCreated({ rule: result, labels });
      }}
      onCancel={props.onCancel}
    />
  );
};

export default AutomationPresetSetup;
