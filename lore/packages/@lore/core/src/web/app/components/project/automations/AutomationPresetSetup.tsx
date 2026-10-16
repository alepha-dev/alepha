import type { SelectOption } from "@alepha/ui/form";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";
import AutomationPresetForm from "./AutomationPresetForm.tsx";
import { useAutomationOptions } from "./useAutomationOptions.ts";

export interface AutomationPresetSetupProps {
  preset: AutomationPresetDescriptor;
  channels: Array<{ key: string; available: boolean }>;
  onCancel: () => void;
}

/**
 * One preset's inputs. A created rule opens on its own page, which owns
 * Test and Enable, so there is one place a rule is reviewed rather than two.
 */
const AutomationPresetSetup = (props: AutomationPresetSetupProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const router = useRouter<AutomationRouter>();
  const slots = Object.values(props.preset.slots);
  const members = useAutomationOptions("member");
  const folios = useAutomationOptions("folio");
  const apps = useAutomationOptions("app");
  const variables = useQuery(
    {
      key: ["automation-variables", project?.id, 0],
      enabled: !!project && slots.some((slot) => slot.bindable),
      handler: ({ signal }) =>
        api.listAutomationVariables(
          {
            params: { projectId: project!.id },
            query: { offset: 0, limit: 50 },
          },
          { request: { signal } },
        ),
    },
    [project?.id],
  );
  if (!project) return null;
  const choices: Record<
    string,
    SelectOption[] | ((search: string) => Promise<SelectOption[]>)
  > = {};
  for (const [name, slot] of Object.entries(props.preset.slots)) {
    if (slot.kind === "member") choices[name] = members;
    else if (slot.kind === "folio") choices[name] = folios;
    else if (slot.resource === "app") choices[name] = apps;
    else if (slot.kind === "channel")
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
      variables={variables.data?.items ?? []}
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
      onSubmit={async (values, bindings) => {
        const result = await api.createAutomationFromPreset({
          params: { projectId: project.id },
          body: { key: props.preset.key, values, bindings },
        });
        queries.invalidate(["automations", project.id]);
        await router.push("projectAutomationDetail", {
          params: { projectSlug: project.slug, automationId: result.id },
        });
      }}
      onCancel={props.onCancel}
    />
  );
};

export default AutomationPresetSetup;
