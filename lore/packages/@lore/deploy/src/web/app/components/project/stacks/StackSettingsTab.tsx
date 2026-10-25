import { Button, useDialog, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  SettingsDangerSection,
  SettingsRow,
  SettingsSection,
} from "@alepha/ui/settings";
import { type I18n, useRank } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { StackController } from "../../../../../api/controllers/StackController.ts";
import type { StackEnvironmentResource } from "../../../../../api/schemas/stackEnvironmentResourceSchema.ts";
import type { StackResource } from "../../../../../api/schemas/stackResourceSchema.ts";
import type { StackTarget } from "./stackTarget.ts";

export interface StackSettingsTabProps {
  target: StackTarget;
  stack: StackResource;
  environment: StackEnvironmentResource;
  estates: Array<{ id: string; slug: string; label?: string }>;
  projectSlug: string;
}

/**
 * Where the stack deploys and how this environment is addressed: the stack's
 * default estate, this environment's override, its base domain, and deleting
 * the environment from Lore (nothing on the estate is touched).
 */
const StackSettingsTab = (props: StackSettingsTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const dialog = useDialog();
  const toaster = useToast();
  const router = useRouter();
  const api = useClient<StackController>();
  const queries = useQueryClient();
  const canWrite = can("deploy:manage");
  const refresh = () => queries.invalidate(["stacks", props.target.projectId]);
  const estateItems = props.estates.map((e) => ({
    value: e.id,
    label: e.label ? `${e.slug} (${e.label})` : e.slug,
  }));

  const stackForm = useForm({
    id: `stack-settings-estate-${props.stack.id}`,
    schema: z.object({ estateId: z.text() }),
    initialValues: { estateId: props.stack.estateId ?? NONE },
    handler: () => {},
    onChange: (_key, value) =>
      void saveStackEstate.run(value === NONE ? null : String(value)),
  });
  const saveStackEstate = useAction<[estateId: string | null], boolean>(
    {
      handler: async (_ctx, estateId) => {
        await api.updateStack({
          params: {
            projectId: props.target.projectId,
            stackId: props.stack.id,
          },
          body: { estateId },
        });
        toaster.success(tr("stacks.settings.saved"));
        return true;
      },
      invalidates: [["stacks", props.target.projectId]],
    },
    [api, toaster, tr, props.stack.id],
  );

  const envForm = useForm({
    id: `stack-settings-override-${props.environment.id}`,
    schema: z.object({ estateId: z.text() }),
    initialValues: { estateId: props.environment.estateId ?? NONE },
    handler: () => {},
    onChange: (_key, value) =>
      void saveOverride.run(value === NONE ? null : String(value)),
  });
  const saveOverride = useAction<[estateId: string | null], boolean>(
    {
      handler: async (_ctx, estateId) => {
        await api.updateStackEnvironment({
          params: props.target,
          body: { estateId },
        });
        toaster.success(tr("stacks.settings.saved"));
        return true;
      },
      invalidates: [["stacks", props.target.projectId]],
    },
    [api, toaster, tr, props.target],
  );

  const domainForm = useForm({
    id: `stack-settings-domain-${props.environment.id}`,
    schema: z.object({ baseDomain: z.string().max(253).optional() }),
    initialValues: { baseDomain: props.environment.baseDomain ?? "" },
    handler: async (input) => {
      await api.updateStackEnvironment({
        params: props.target,
        body: { baseDomain: input.baseDomain?.trim() || null },
      });
      refresh();
      toaster.success(tr("stacks.settings.saved"));
    },
  });
  const { loading: savingDomain } = useFormState(domainForm, ["loading"]);

  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        const name = `${props.stack.name}/${props.environment.env}`;
        const confirmed = await dialog.confirm({
          title: tr("stacks.settings.delete.confirm", { args: [name] }),
          description: tr("stacks.settings.delete.description"),
          confirmLabel: tr("stacks.settings.delete"),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await api.deleteStackEnvironment({ params: props.target });
        toaster.success(tr("stacks.settings.deleted"));
        await router.push("projectStacks", {
          params: { projectSlug: props.projectSlug },
        });
        return true;
      },
      invalidates: [["stacks", props.target.projectId]],
    },
    [api, dialog, toaster, tr, router, props.target, props.projectSlug],
  );

  const busy =
    saveStackEstate.loading || saveOverride.loading || remove.loading;

  return (
    <div className="flex flex-col gap-4" data-testid="stack-settings">
      <SettingsSection
        title={tr("stacks.settings.estate")}
        description={tr("stacks.settings.estate.description")}
      >
        <SettingsRow
          label={tr("stacks.settings.estate.stack", {
            args: [props.stack.name],
          })}
        >
          <Control
            select
            input={stackForm.input.estateId}
            label=""
            disabled={!canWrite || busy}
            triggerClassName="w-full sm:w-72"
            items={[
              { value: NONE, label: tr("stacks.estate.unset") },
              ...estateItems,
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label={tr("stacks.settings.override", {
            args: [props.environment.env],
          })}
          description={tr("stacks.settings.override.description")}
        >
          <Control
            select
            input={envForm.input.estateId}
            label=""
            disabled={!canWrite || busy}
            triggerClassName="w-full sm:w-72"
            items={[
              { value: NONE, label: tr("stacks.estate.default") },
              ...estateItems,
            ]}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={tr("stacks.settings.baseDomain")}
        description={tr("stacks.settings.baseDomain.description")}
      >
        <SettingsRow label={tr("stacks.settings.baseDomain")}>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void domainForm.submit();
            }}
          >
            <Control
              input={domainForm.input.baseDomain}
              label=""
              disabled={!canWrite}
            />
            <Button
              type="submit"
              variant="outlined"
              disabled={!canWrite || savingDomain}
            >
              {tr("stacks.settings.save")}
            </Button>
          </form>
        </SettingsRow>
      </SettingsSection>
      {canWrite ? (
        <SettingsDangerSection title={tr("stacks.settings.danger")}>
          <SettingsRow
            label={tr("stacks.settings.delete")}
            description={tr("stacks.settings.delete.description")}
          >
            <Button
              intent="danger"
              disabled={busy}
              onClick={() => void remove.run()}
              data-testid="stack-environment-delete"
            >
              {tr("stacks.settings.delete")}
            </Button>
          </SettingsRow>
        </SettingsDangerSection>
      ) : null}
    </div>
  );
};

export default StackSettingsTab;

/**
 * The value a select carries for "none": Base UI reads `""` as nothing
 * selected and would show the placeholder instead of the row.
 */
const NONE = "__none__";
