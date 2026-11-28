import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  currentProjectAtom,
  type I18n,
  useLoreEditorControl,
} from "@lore/core/web";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm, useFormState, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  BookMarked,
  ClipboardCheck,
  FileText,
  Pilcrow,
  Plus,
  Save,
  Shapes,
  SignalHigh,
  Type,
} from "lucide-react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import { requirementInputSchema } from "../../../../api/schemas/requirementInputSchema.ts";
import type { RequirementMetric } from "../../../../api/schemas/requirementMetricSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";

const VERIFY_BY_LABEL_KEYS = {
  usecases: "requirements.requirement.verifyBy.usecases",
  vital: "requirements.requirement.metric.kind.vital",
  availability: "requirements.requirement.metric.kind.availability",
  latency: "requirements.requirement.metric.kind.latency",
  api: "requirements.requirement.metric.kind.api",
} as const;

/**
 * The metric fields of the form, flat, and the metric they make.
 */
const metricFields = {
  verifyBy: z.enum(["usecases", "vital", "availability", "latency", "api"]),
  metricVital: z.enum(["lcp", "inp", "cls"]).optional(),
  metricPercentile: z.integer().min(1).max(99).optional(),
  metricPath: z.text().optional(),
  metricMethod: z.text().optional(),
  metricMonitorId: z.text().optional(),
  metricApp: z.text().optional(),
  metricEnv: z.text().optional(),
  metricThreshold: z.number().optional(),
  metricWindowDays: z.integer().min(1).max(90).optional(),
};

export interface RequirementSheetProps {
  projectId: number;
  requirement?: RequirementResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (requirement: RequirementResource) => void;
}

/**
 * The requirement form in its drawer (#E153), for create and edit. Saving
 * an edit of a requirement flagged Source changed resyncs it: that is
 * "Update the requirement".
 */
const RequirementSheet = (props: RequirementSheetProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const it = props.requirement;

  const form = useForm(
    {
      id: "requirement-form",
      schema: requirementInputSchema
        .pick({
          statement: true,
          description: true,
          type: true,
          priority: true,
          chapter: true,
          paragraph: true,
        })
        .required({ statement: true })
        .extend(metricFields),
      initialValues: it
        ? {
            statement: it.statement,
            description: it.description,
            type: it.type,
            priority: it.priority,
            chapter: it.chapter ?? "",
            paragraph: it.paragraph ?? "",
            verifyBy: it.metric?.kind ?? ("usecases" as const),
            metricVital: it.metric?.vital,
            metricPercentile: it.metric?.percentile,
            metricPath: it.metric?.path ?? "",
            metricMethod: it.metric?.method ?? "",
            metricMonitorId: it.metric?.monitorId ?? "",
            metricApp: it.metric?.app ?? "",
            metricEnv: it.metric?.env ?? "",
            metricThreshold: it.metric?.threshold,
            metricWindowDays: it.metric?.windowDays,
          }
        : {
            type: "functional" as const,
            priority: "should" as const,
            verifyBy: "usecases" as const,
          },
      handler: async (data) => {
        const {
          verifyBy,
          metricVital,
          metricPercentile,
          metricPath,
          metricMethod,
          metricMonitorId,
          metricApp,
          metricEnv,
          metricThreshold,
          metricWindowDays,
          ...fields
        } = data;
        const metric: RequirementMetric | null | undefined =
          verifyBy === "usecases" || metricThreshold === undefined
            ? it?.metric
              ? null
              : undefined
            : {
                kind: verifyBy,
                ...(verifyBy === "vital"
                  ? {
                      vital: metricVital ?? "lcp",
                      path: metricPath || undefined,
                    }
                  : verifyBy === "api"
                    ? {
                        path: metricPath || undefined,
                        method: metricMethod?.toUpperCase() || undefined,
                      }
                    : { monitorId: metricMonitorId || undefined }),
                percentile:
                  verifyBy === "availability" ? undefined : metricPercentile,
                app: metricApp || undefined,
                env: metricEnv || undefined,
                threshold: metricThreshold,
                windowDays: metricWindowDays,
              };
        const body = {
          ...fields,
          statement: fields.statement.trim(),
          chapter: fields.chapter || undefined,
          paragraph: fields.paragraph || undefined,
          ...(metric !== undefined ? { metric } : {}),
        };
        let saved = it
          ? await api.updateRequirement({ params: { id: it.id }, body })
          : await api.createRequirement({
              params: { projectId: props.projectId },
              body,
            });
        if (it?.sourceChanged) {
          saved = await api.resyncRequirementSource({ params: { id: it.id } });
        }
        toaster.success(
          tr(
            it
              ? "requirements.requirement.toast.updated"
              : "requirements.requirement.toast.created",
          ),
        );
        props.onSubmit(saved);
      },
    },
    [it?.id],
  );
  const { loading } = useFormState(form, ["loading"]);
  const { verifyBy } = useFormValues(form);
  // Disabled rather than hidden, as the persona, use case and epic forms.
  const canSave = it
    ? api.updateRequirement.can()
    : api.createRequirement.can();
  const DescriptionEditor = useLoreEditorControl({
    kind: "requirement",
    projectId: props.projectId,
    projectSlug: project?.slug ?? "",
    id: it?.id,
  });

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {tr(
              it
                ? "requirements.requirement.edit"
                : "project.menu.create-requirement",
            )}
          </SheetTitle>
        </SheetHeader>
        <form {...form.props} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <Control
              label={tr("requirements.requirement.field.statement")}
              description={tr(
                "requirements.requirement.field.statement.helper",
              )}
              input={form.input.statement}
              icon={Type}
            />
            <div className="grid grid-cols-2 gap-4">
              <Control
                label={tr("requirements.requirement.field.type")}
                input={form.input.type}
                icon={Shapes}
              />
              <Control
                label={tr("requirements.requirement.field.priority")}
                input={form.input.priority}
                icon={SignalHigh}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Control
                label={tr("requirements.requirement.field.chapter")}
                description={tr(
                  "requirements.requirement.field.chapter.helper",
                )}
                input={form.input.chapter}
                icon={BookMarked}
              />
              <Control
                label={tr("requirements.requirement.field.paragraph")}
                input={form.input.paragraph}
                icon={Pilcrow}
              />
            </div>
            <Control
              label={tr("requirements.requirement.field.description")}
              input={form.input.description}
              icon={FileText}
              custom={DescriptionEditor}
            />
            <Control
              label={tr("requirements.requirement.verifyBy")}
              input={form.input.verifyBy}
              icon={ClipboardCheck}
              select
              items={(
                ["usecases", "vital", "availability", "latency", "api"] as const
              ).map((value) => ({
                value,
                label: tr(VERIFY_BY_LABEL_KEYS[value]),
              }))}
            />
            {verifyBy && verifyBy !== "usecases" ? (
              <div
                className="flex flex-col gap-4 rounded-md border p-3"
                data-testid="metric-fields"
              >
                <p className="text-muted-foreground text-xs">
                  {tr("requirements.requirement.metric.alephaOnly")}
                </p>
                {verifyBy === "vital" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Control
                      label={tr("requirements.requirement.metric.vital")}
                      input={form.input.metricVital}
                    />
                    <Control
                      label={tr("requirements.requirement.metric.path")}
                      input={form.input.metricPath}
                    />
                  </div>
                ) : verifyBy === "api" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Control
                      label={tr("requirements.requirement.metric.route")}
                      input={form.input.metricPath}
                    />
                    <Control
                      label={tr("requirements.requirement.metric.method")}
                      input={form.input.metricMethod}
                    />
                  </div>
                ) : (
                  <Control
                    label={tr("requirements.requirement.metric.monitor")}
                    input={form.input.metricMonitorId}
                  />
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Control
                    label={tr("requirements.requirement.metric.app")}
                    input={form.input.metricApp}
                  />
                  <Control
                    label={tr("requirements.requirement.metric.env")}
                    input={form.input.metricEnv}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Control
                    label={tr("requirements.requirement.metric.threshold")}
                    input={form.input.metricThreshold}
                  />
                  {verifyBy !== "availability" ? (
                    <Control
                      label={tr("requirements.requirement.metric.percentile")}
                      input={form.input.metricPercentile}
                    />
                  ) : null}
                  <Control
                    label={tr("requirements.requirement.metric.window")}
                    input={form.input.metricWindowDays}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
            <Button type="submit" disabled={!canSave} loading={loading}>
              {it ? <Save className="size-4" /> : <Plus className="size-4" />}
              {tr(
                it
                  ? "requirements.requirement.form.update"
                  : "requirements.requirement.form.create",
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default RequirementSheet;
