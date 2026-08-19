import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { FileText, Plus, Save, Tag } from "lucide-react";
import type { EpicController } from "@/api/controllers/EpicController.ts";
import { epicCreateSchema } from "@/api/schemas/epicCreateSchema.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { useLoreEditorControl } from "../../shared/element/useLoreEditorControl.ts";

export interface EpicCreateProps {
  projectId: number;
  /**
   * Present ⇒ edit that epic; absent ⇒ create a new one. One component in
   * two modes, the way `QuestCreate` works, so the form that made an epic
   * is the form that edits it and the two can never drift on validation or
   * on which widget renders the description.
   */
  epic?: EpicResource;
  onSubmit: (epic: EpicResource) => void;
}

/**
 * The epic form, sized for the right-hand drawer the header's create button
 * opens — a scrolling body over a footer pinned to the bottom, the same
 * shape as `QuestCreate` inside the same `Sheet`.
 *
 * Only title and description. Status is not offered: a new epic always
 * starts `planned` (`EpicController.createEpic`), and moving it is the
 * lifecycle verbs' job on the detail page, never a dropdown on a form.
 */
const EpicCreate = (props: EpicCreateProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const epicApi = useClient<EpicController>();
  const [project] = useStore(currentProjectAtom);
  const update = !!props.epic?.id;

  const form = useForm({
    id: "epic-create",
    schema: epicCreateSchema,
    // Only in edit mode. `useForm` DECODES its initial values against the
    // schema at construction, so seeding `title: ""` for a new epic throws
    // `Too small: expected string to have >=3 characters` before the drawer
    // renders a single field — the whole page falls to the error boundary.
    // An absent key is not decoded; an empty one is. (`QuestCreate` never
    // meets this because its `title` carries no `min`.)
    initialValues: props.epic
      ? {
          title: props.epic.title,
          description: props.epic.description ?? "",
        }
      : undefined,
    handler: async (data) => {
      const body = {
        title: data.title.trim(),
        description: data.description?.trim() || undefined,
      };
      try {
        const saved = props.epic?.id
          ? await epicApi.updateEpic({
              params: { id: props.epic.id },
              // Sent even when cleared, unlike create: `updateEpic` treats an
              // omitted key as "leave unchanged", so `undefined` here would
              // make an emptied description un-clearable.
              body: { ...body, description: data.description?.trim() ?? "" },
            })
          : await epicApi.createEpic({
              params: { projectId: props.projectId },
              body,
            });
        toaster.success(
          update ? tr("epic.toast.updated") : tr("epic.toast.created"),
        );
        props.onSubmit(saved);
      } catch (error) {
        toaster.error(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  });

  const { loading: submitting } = useFormState(form, ["loading"]);

  const DescriptionEditor = useLoreEditorControl({
    kind: "epic",
    projectId: props.projectId,
    projectSlug: project?.slug ?? "",
    id: props.epic?.id,
  });

  return (
    <form {...form.props} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Control
          label={tr("epic.create.title.label")}
          description={tr("epic.create.title.helper")}
          input={form.input.title}
          icon={Tag}
        />
        <Control
          label={tr("epic.create.description.label")}
          description={tr("epic.create.description.helper")}
          input={form.input.description}
          icon={FileText}
          custom={DescriptionEditor as never}
        />
      </div>

      <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
        <Button type="submit" disabled={submitting}>
          {update ? <Save className="size-4" /> : <Plus className="size-4" />}
          {update ? tr("epic.create.update") : tr("epic.create.submit")}
        </Button>
      </div>
    </form>
  );
};

export default EpicCreate;
