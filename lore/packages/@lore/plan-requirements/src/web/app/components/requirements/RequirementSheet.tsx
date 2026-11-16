import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Plus, Save } from "lucide-react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import { requirementInputSchema } from "../../../../api/schemas/requirementInputSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";

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
        .required({ statement: true }),
      initialValues: it
        ? {
            statement: it.statement,
            description: it.description,
            type: it.type,
            priority: it.priority,
            chapter: it.chapter ?? "",
            paragraph: it.paragraph ?? "",
          }
        : { type: "functional" as const, priority: "should" as const },
      handler: async (data) => {
        const body = {
          ...data,
          statement: data.statement.trim(),
          chapter: data.chapter || undefined,
          paragraph: data.paragraph || undefined,
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
              input={form.input.statement}
            />
            <div className="grid grid-cols-2 gap-4">
              <Control
                label={tr("requirements.requirement.field.type")}
                input={form.input.type}
              />
              <Control
                label={tr("requirements.requirement.field.priority")}
                input={form.input.priority}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Control
                label={tr("requirements.requirement.field.chapter")}
                input={form.input.chapter}
              />
              <Control
                label={tr("requirements.requirement.field.paragraph")}
                input={form.input.paragraph}
              />
            </div>
            <Control
              label={tr("requirements.requirement.field.description")}
              input={form.input.description}
            />
          </div>
          <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
            <Button type="submit" disabled={loading}>
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
