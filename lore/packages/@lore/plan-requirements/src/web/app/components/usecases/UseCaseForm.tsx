import { Button, useToast } from "@alepha/ui";
import { Control, ControlArray } from "@alepha/ui/form";
import {
  currentProjectAtom,
  formatReference,
  type I18n,
  useLoreEditorControl,
} from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  CircleDot,
  Database,
  FileCode,
  FileText,
  Plus,
  Save,
  SignalHigh,
  Tag,
  Type,
} from "lucide-react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import { actorRoleSchema } from "../../../../api/schemas/actorRoleSchema.ts";
import { criterionMethodSchema } from "../../../../api/schemas/criterionMethodSchema.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import { useCaseInputSchema } from "../../../../api/schemas/useCaseInputSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import {
  ACTOR_ROLE_LABEL_KEYS,
  CRITERION_METHOD_LABEL_KEYS,
} from "./useCaseLabels.ts";

export interface UseCaseFormProps {
  projectId: number;
  useCase?: UseCaseResource;
  onSubmit: (useCase: UseCaseResource) => void;
}

/**
 * The use case form (#E153), for create and edit. Its fields, then the
 * scenario as lists the reader adds to, removes from and reorders: actors
 * (a persona and its role), steps (who acts it, and what happens),
 * alternatives (a key such as `4a`, and its text) and acceptance criteria
 * (Given / When / Then or free text, and how it is verified). Every choice
 * is a picker: nothing is typed in a notation of the form's own.
 */
const UseCaseForm = (props: UseCaseFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  const personaApi = useClient<PersonaController>();
  const useCase = props.useCase;

  const personas = useQuery<PersonaResource[]>(
    {
      key: ["personas", props.projectId],
      handler: async () =>
        await personaApi.getPersonas({
          params: { projectId: props.projectId },
          query: {},
        }),
    },
    [personaApi, props.projectId],
  );

  // Persona ids travel as strings: a select's value is one.
  const schema = useCaseInputSchema
    .pick({
      title: true,
      priority: true,
      preconditions: true,
      startingData: true,
      automatedTestPath: true,
      automatedTestTag: true,
    })
    .required({ title: true })
    .extend({
      status: z.enum(["draft", "ready", "deprecated"]).optional(),
      actors: z
        .array(z.object({ persona: z.string(), role: actorRoleSchema }))
        .optional(),
      steps: z
        .array(
          z.object({
            actor: z.string().optional(),
            text: z.string().min(1).max(2000),
          }),
        )
        .optional(),
      alternatives: z
        .array(
          z.object({
            key: z.string().min(1).max(10),
            text: z.string().min(1).max(2000),
          }),
        )
        .optional(),
      criteria: z
        .array(
          z.object({
            key: z.string().max(10).optional(),
            method: criterionMethodSchema,
            givenText: z.string().max(2000).optional(),
            whenText: z.string().max(2000).optional(),
            thenText: z.string().max(2000).optional(),
            text: z.string().max(2000).optional(),
            alternativeKey: z.string().max(10).optional(),
          }),
        )
        .optional(),
    });

  const form = useForm({
    id: "use-case-form",
    schema,
    initialValues: useCase
      ? {
          title: useCase.title,
          status: useCase.status === "validated" ? undefined : useCase.status,
          priority: useCase.priority,
          preconditions: useCase.preconditions,
          startingData: useCase.startingData ?? "",
          automatedTestPath: useCase.automatedTestPath ?? "",
          automatedTestTag: useCase.automatedTestTag ?? "",
          actors: useCase.actors.map((a) => ({
            persona: String(a.personaId),
            role: a.role,
          })),
          steps: useCase.steps.map((s) => ({
            actor:
              s.actorPersonaId !== undefined
                ? String(s.actorPersonaId)
                : undefined,
            text: s.text,
          })),
          alternatives: useCase.alternatives.map((a) => ({
            key: a.key,
            text: a.text,
          })),
          criteria: useCase.criteria.map((c) => ({
            key: c.key,
            method: c.method,
            givenText: c.givenText ?? "",
            whenText: c.whenText ?? "",
            thenText: c.thenText ?? "",
            text: c.text ?? "",
            alternativeKey: c.alternativeKey ?? "",
          })),
        }
      : { priority: "medium" as const },
    handler: async (data) => {
      const body = {
        title: data.title.trim(),
        ...(data.status ? { status: data.status } : {}),
        priority: data.priority,
        preconditions: data.preconditions ?? "",
        startingData: data.startingData || undefined,
        automatedTestPath: data.automatedTestPath || undefined,
        automatedTestTag: data.automatedTestTag || undefined,
        actors: (data.actors ?? [])
          .filter((a) => a.persona)
          .map((a) => ({ personaId: Number(a.persona), role: a.role })),
        steps: (data.steps ?? []).map((s) => ({
          ...(s.actor ? { actorPersonaId: Number(s.actor) } : {}),
          text: s.text,
        })),
        alternatives: data.alternatives ?? [],
        criteria: (data.criteria ?? []).map((c) => ({
          ...(c.key ? { key: c.key } : {}),
          method: c.method,
          // Given / When / Then when any is written, else the free text.
          ...(c.givenText || c.whenText || c.thenText
            ? {
                givenText: c.givenText || undefined,
                whenText: c.whenText || undefined,
                thenText: c.thenText || undefined,
              }
            : { text: c.text || undefined }),
          ...(c.alternativeKey ? { alternativeKey: c.alternativeKey } : {}),
        })),
      };
      const saved = useCase
        ? await useCaseApi.updateUseCase({ params: { id: useCase.id }, body })
        : await useCaseApi.createUseCase({
            params: { projectId: props.projectId },
            body,
          });
      toaster.success(
        tr(
          useCase
            ? "requirements.usecase.toast.updated"
            : "requirements.usecase.toast.created",
        ),
      );
      props.onSubmit(saved);
    },
  });
  const { loading } = useFormState(form, ["loading"]);
  const canSave = useCase
    ? useCaseApi.updateUseCase.can()
    : useCaseApi.createUseCase.can();

  const PreconditionsEditor = useLoreEditorControl({
    kind: "usecase",
    projectId: props.projectId,
    projectSlug: project?.slug ?? "",
    id: useCase?.id,
  });

  const personaItems = (personas.data ?? []).map((p) => ({
    value: String(p.id),
    label: `${formatReference("persona", p.number)} ${p.name}`,
  }));

  return (
    <form {...form.props} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Control
          label={tr("requirements.usecase.field.title")}
          description={tr("requirements.usecase.field.title.helper")}
          input={form.input.title}
          icon={Type}
        />
        <div className="grid grid-cols-2 gap-4">
          <Control
            label={tr("requirements.usecase.field.status")}
            input={form.input.status}
            icon={CircleDot}
          />
          <Control
            label={tr("requirements.usecase.field.priority")}
            input={form.input.priority}
            icon={SignalHigh}
          />
        </div>
        <ControlArray
          label={tr("requirements.usecase.field.actors")}
          description={tr("requirements.usecase.field.actors.helper")}
          input={form.input.actors}
          addLabel={tr("requirements.usecase.field.actors.add")}
          columns={2}
          controlProps={{
            persona: {
              label: tr("requirements.usecase.filter.persona"),
              select: true,
              items: personaItems,
            },
            role: {
              label: tr("requirements.persona.field.role"),
              select: true,
              items: actorRoleSchema.options.map((value) => ({
                value,
                label: tr(ACTOR_ROLE_LABEL_KEYS[value]),
              })),
            },
          }}
        />
        <Control
          label={tr("requirements.usecase.field.preconditions")}
          description={tr("requirements.usecase.field.preconditions.helper")}
          input={form.input.preconditions}
          icon={FileText}
          custom={PreconditionsEditor}
        />
        <ControlArray
          label={tr("requirements.usecase.field.steps")}
          description={tr("requirements.usecase.field.steps.helper")}
          input={form.input.steps}
          addLabel={tr("requirements.usecase.field.steps.add")}
          columns={2}
          controlProps={{
            actor: {
              label: tr("requirements.usecase.field.steps.actor"),
              select: true,
              clearable: true,
              // Empty means the system acts: the placeholder says so.
              placeholder: tr("requirements.usecase.system"),
              clearLabel: tr("requirements.usecase.system"),
              items: personaItems,
            },
            text: {
              label: tr("requirements.usecase.field.steps.text"),
              area: true,
              rows: 2,
            },
          }}
        />
        <ControlArray
          label={tr("requirements.usecase.field.alternatives")}
          description={tr("requirements.usecase.field.alternatives.helper")}
          input={form.input.alternatives}
          addLabel={tr("requirements.usecase.field.alternatives.add")}
          columns={2}
          controlProps={{
            key: { label: tr("requirements.usecase.field.alternatives.key") },
            text: {
              label: tr("requirements.usecase.field.steps.text"),
              area: true,
              rows: 2,
            },
          }}
        />
        <ControlArray
          label={tr("requirements.usecase.field.criteria")}
          description={tr("requirements.usecase.field.criteria.helper")}
          input={form.input.criteria}
          addLabel={tr("requirements.usecase.field.criteria.add")}
          columns={2}
          controlProps={{
            key: {
              label: tr("requirements.usecase.field.criteria.key"),
              // Lore numbers a criterion (C1, C2) when it is saved.
              disabled: true,
            },
            method: {
              label: tr("requirements.usecase.field.criteria.method"),
              select: true,
              items: criterionMethodSchema.options.map((value) => ({
                value,
                label: tr(CRITERION_METHOD_LABEL_KEYS[value]),
              })),
            },
            givenText: { label: tr("requirements.usecase.given") },
            whenText: { label: tr("requirements.usecase.when") },
            thenText: { label: tr("requirements.usecase.then") },
            text: {
              label: tr("requirements.usecase.field.criteria.text"),
              area: true,
              rows: 2,
            },
            alternativeKey: {
              label: tr("requirements.usecase.field.criteria.alternative"),
            },
          }}
        />
        <Control
          label={tr("requirements.usecase.field.startingData")}
          description={tr("requirements.usecase.field.startingData.helper")}
          input={form.input.startingData}
          icon={Database}
        />
        <div className="grid grid-cols-2 gap-4">
          <Control
            label={tr("requirements.usecase.field.automatedTestPath")}
            input={form.input.automatedTestPath}
            icon={FileCode}
          />
          <Control
            label={tr("requirements.usecase.field.automatedTestTag")}
            input={form.input.automatedTestTag}
            icon={Tag}
          />
        </div>
      </div>
      <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
        <Button type="submit" disabled={loading || !canSave}>
          {useCase ? <Save className="size-4" /> : <Plus className="size-4" />}
          {tr(
            useCase
              ? "requirements.usecase.form.update"
              : "requirements.usecase.form.create",
          )}
        </Button>
      </div>
    </form>
  );
};

export default UseCaseForm;
