import { Button, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Plus, Save } from "lucide-react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import { personaInputSchema } from "../../../../api/schemas/personaInputSchema.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";

export interface PersonaFormProps {
  projectId: number;
  /**
   * Present: the form edits that persona; absent: it creates one.
   */
  persona?: PersonaResource;
  onSubmit: (persona: PersonaResource) => void;
}

/**
 * The persona form (#E153), in the right-hand drawer: one component for
 * create and edit, so the two never drift on validation.
 */
const PersonaForm = (props: PersonaFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const personaApi = useClient<PersonaController>();
  const persona = props.persona;

  const form = useForm({
    id: "persona-form",
    schema: personaInputSchema.required({ name: true }),
    // Only on edit: `useForm` decodes its initial values, and an empty name
    // would fail `min(1)` before the drawer draws a field.
    initialValues: persona
      ? {
          kind: persona.kind,
          name: persona.name,
          role: persona.role ?? "",
          who: persona.who,
          goals: persona.goals,
          frustrations: persona.frustrations,
          alephaRole: persona.alephaRole ?? "",
          demoAccount: persona.demoAccount ?? "",
          demoSeed: persona.demoSeed ?? "",
          environmentApp: persona.environmentApp ?? "",
          environmentEnv: persona.environmentEnv ?? "",
        }
      : { kind: "human" as const },
    handler: async (data) => {
      const body = {
        ...data,
        name: data.name.trim(),
      };
      const saved = persona
        ? await personaApi.updatePersona({ params: { id: persona.id }, body })
        : await personaApi.createPersona({
            params: { projectId: props.projectId },
            body,
          });
      toaster.success(
        tr(
          persona
            ? "requirements.persona.toast.updated"
            : "requirements.persona.toast.created",
        ),
      );
      props.onSubmit(saved);
    },
  });

  const { loading } = useFormState(form, ["loading"]);
  const canSave = persona
    ? personaApi.updatePersona.can()
    : personaApi.createPersona.can();

  return (
    <form {...form.props} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Control
          label={tr("requirements.persona.field.name")}
          input={form.input.name}
        />
        <Control
          label={tr("requirements.persona.field.kind")}
          input={form.input.kind}
        />
        <Control
          label={tr("requirements.persona.field.role")}
          description={tr("requirements.persona.field.role.helper")}
          input={form.input.role}
        />
        <Control
          label={tr("requirements.persona.field.who")}
          input={form.input.who}
        />
        <Control
          label={tr("requirements.persona.field.goals")}
          input={form.input.goals}
        />
        <Control
          label={tr("requirements.persona.field.frustrations")}
          input={form.input.frustrations}
        />
        <Control
          label={tr("requirements.persona.field.alephaRole")}
          description={tr("requirements.persona.field.alephaRole.helper")}
          input={form.input.alephaRole}
        />
        <Control
          label={tr("requirements.persona.field.demoAccount")}
          description={tr("requirements.persona.field.demoAccount.helper")}
          input={form.input.demoAccount}
        />
        <Control
          label={tr("requirements.persona.field.demoSeed")}
          input={form.input.demoSeed}
        />
        <div className="grid grid-cols-2 gap-4">
          <Control
            label={tr("requirements.persona.field.environmentApp")}
            input={form.input.environmentApp}
          />
          <Control
            label={tr("requirements.persona.field.environmentEnv")}
            input={form.input.environmentEnv}
          />
        </div>
      </div>
      <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
        <Button type="submit" disabled={loading || !canSave}>
          {persona ? <Save className="size-4" /> : <Plus className="size-4" />}
          {tr(
            persona
              ? "requirements.persona.form.update"
              : "requirements.persona.form.create",
          )}
        </Button>
      </div>
    </form>
  );
};

export default PersonaForm;
