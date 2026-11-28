import { Button, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  currentProjectAtom,
  type I18n,
  useLoreEditorControl,
} from "@lore/core/web";
import { useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  AppWindow,
  Database,
  Frown,
  IdCard,
  KeyRound,
  Plus,
  Save,
  Server,
  Shapes,
  Target,
  UserRound,
  UserRoundSearch,
} from "lucide-react";

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
  const [project] = useStore(currentProjectAtom);
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

  // One editor for the three bodies: the same element, so the same
  // component identity, and `[[#Q12]]` and images work in each.
  const BodyEditor = useLoreEditorControl({
    kind: "persona",
    projectId: props.projectId,
    projectSlug: project?.slug ?? "",
    id: persona?.id,
  });

  return (
    <form {...form.props} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Control
          label={tr("requirements.persona.field.name")}
          description={tr("requirements.persona.field.name.helper")}
          input={form.input.name}
          icon={UserRound}
        />
        <Control
          label={tr("requirements.persona.field.kind")}
          input={form.input.kind}
          icon={Shapes}
        />
        <Control
          label={tr("requirements.persona.field.role")}
          description={tr("requirements.persona.field.role.helper")}
          input={form.input.role}
          icon={IdCard}
        />
        <Control
          label={tr("requirements.persona.field.who")}
          description={tr("requirements.persona.field.who.helper")}
          input={form.input.who}
          icon={UserRoundSearch}
          custom={BodyEditor}
        />
        <Control
          label={tr("requirements.persona.field.goals")}
          description={tr("requirements.persona.field.goals.helper")}
          input={form.input.goals}
          icon={Target}
          custom={BodyEditor}
        />
        <Control
          label={tr("requirements.persona.field.frustrations")}
          description={tr("requirements.persona.field.frustrations.helper")}
          input={form.input.frustrations}
          icon={Frown}
          custom={BodyEditor}
        />
        <Control
          label={tr("requirements.persona.field.alephaRole")}
          description={tr("requirements.persona.field.alephaRole.helper")}
          input={form.input.alephaRole}
          icon={KeyRound}
        />
        <Control
          label={tr("requirements.persona.field.demoAccount")}
          description={tr("requirements.persona.field.demoAccount.helper")}
          input={form.input.demoAccount}
          icon={UserRound}
        />
        <Control
          label={tr("requirements.persona.field.demoSeed")}
          description={tr("requirements.persona.field.demoSeed.helper")}
          input={form.input.demoSeed}
          icon={Database}
        />
        <div className="grid grid-cols-2 gap-4">
          <Control
            label={tr("requirements.persona.field.environmentApp")}
            input={form.input.environmentApp}
            icon={AppWindow}
          />
          <Control
            label={tr("requirements.persona.field.environmentEnv")}
            input={form.input.environmentEnv}
            icon={Server}
          />
        </div>
      </div>
      <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
        <Button type="submit" disabled={!canSave} loading={loading}>
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
