import { Button, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  currentProjectAtom,
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
  UsersRound,
} from "lucide-react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import { useCaseInputSchema } from "../../../../api/schemas/useCaseInputSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { scenarioToText, textToScenario } from "./scenarioText.ts";

export interface UseCaseFormProps {
  projectId: number;
  useCase?: UseCaseResource;
  onSubmit: (useCase: UseCaseResource) => void;
}

/**
 * The use case form (#E153), for create and edit. Its fields, then the
 * scenario as text: actors as `A2, A3:beneficiary`, one step per line
 * (`A2: text` names who acts it), one alternative per line (`4a: text`),
 * and criteria as blocks of Given / When / Then lines, `[C2] (e2e)` keeping
 * a criterion's key and setting its method.
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
      actorsText: z.text({ size: "rich" }).optional(),
      stepsText: z.text({ size: "rich" }).optional(),
      alternativesText: z.text({ size: "rich" }).optional(),
      criteriaText: z.text({ size: "rich" }).optional(),
    });

  const text = useCase ? scenarioToText(useCase) : undefined;
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
          actorsText: useCase.actors
            .map((a) =>
              a.role === "primary" ? `A${a.number}` : `A${a.number}:${a.role}`,
            )
            .join(", "),
          stepsText: text?.steps ?? "",
          alternativesText: text?.alternatives ?? "",
          criteriaText: text?.criteria ?? "",
        }
      : { priority: "medium" as const },
    handler: async (data) => {
      const ids = new Map((personas.data ?? []).map((p) => [p.number, p.id]));
      const actors = (data.actorsText ?? "")
        .split(",")
        .map((it) => it.trim())
        .filter(Boolean)
        .flatMap((part) => {
          const match = /^#?A(\d+)(?::(primary|beneficiary|system))?$/i.exec(
            part,
          );
          const id = match ? ids.get(Number(match[1])) : undefined;
          return id === undefined
            ? []
            : [
                {
                  personaId: id,
                  role: (match?.[2]?.toLowerCase() ?? "primary") as "primary",
                },
              ];
        });
      const scenario = textToScenario(
        {
          steps: data.stepsText ?? "",
          alternatives: data.alternativesText ?? "",
          criteria: data.criteriaText ?? "",
        },
        ids,
      );
      const body = {
        title: data.title.trim(),
        ...(data.status ? { status: data.status } : {}),
        priority: data.priority,
        preconditions: data.preconditions ?? "",
        startingData: data.startingData || undefined,
        automatedTestPath: data.automatedTestPath || undefined,
        automatedTestTag: data.automatedTestTag || undefined,
        actors,
        ...scenario,
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
        <Control
          label={tr("requirements.usecase.field.actors")}
          description={tr("requirements.usecase.field.actors.helper")}
          input={form.input.actorsText}
          icon={UsersRound}
        />
        <Control
          label={tr("requirements.usecase.field.preconditions")}
          description={tr("requirements.usecase.field.preconditions.helper")}
          input={form.input.preconditions}
          icon={FileText}
          custom={PreconditionsEditor}
        />
        <Control
          label={tr("requirements.usecase.field.steps")}
          description={tr("requirements.usecase.field.steps.helper")}
          input={form.input.stepsText}
        />
        <Control
          label={tr("requirements.usecase.field.alternatives")}
          description={tr("requirements.usecase.field.alternatives.helper")}
          input={form.input.alternativesText}
        />
        <Control
          label={tr("requirements.usecase.field.criteria")}
          description={tr("requirements.usecase.field.criteria.helper")}
          input={form.input.criteriaText}
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
        <Button type="submit" disabled={!canSave} loading={loading}>
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
