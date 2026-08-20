import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { Separator } from "@alepha/ui/components/ui/separator";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  ChevronDown,
  FileText,
  Hourglass,
  Link2,
  ListChecks,
  Plus,
  Save,
  Signature,
  Tag,
  Tags as TagsIcon,
  Tent,
} from "lucide-react";
import { useRef, useState } from "react";
import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import { questCreateSchema } from "@/api/schemas/questCreateSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { useLoreEditorControl } from "../../shared/element/useLoreEditorControl.ts";
import QuestCreateObjectives from "./QuestCreateObjectives.tsx";
import QuestDependencyPicker from "./QuestDependencyPicker.tsx";
import QuestEstimateInput from "./QuestEstimateInput.tsx";
import QuestTagInput from "./QuestTagInput.tsx";

export interface QuestCreateProps {
  onSubmit: (quest: QuestResource) => void;
  onCreated?: (quest: QuestResource) => void;
  quest?: Partial<QuestResource>;
  project: ProjectResource;
}

const QuestCreate = (props: QuestCreateProps) => {
  const questApi = useClient<QuestController>();
  const areaApi = useClient<AreaController>();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [currentAreas] = useStore(currentAreasAtom);

  const questEstimateEnabled = props.project.features?.questEstimate === true;

  const update = !!props.quest?.id;
  const acceptAfterCreate = useRef(false);

  // `dependsOn` is a numeric quest id; managing it as local state (rather than
  // a form field) keeps the picker's value coercion explicit and out of the
  // nullable-integer form binding. Injected into the submit body below.
  const [dependsOn, setDependsOn] = useState<number | null>(
    props.quest?.dependsOn ?? null,
  );
  // `useForm` freezes its handler at first render (built once via useMemo),
  // so it would close over the initial `dependsOn`. Mirror it through a ref
  // that's refreshed every render so submit reads the picked value.
  const dependsOnRef = useRef(dependsOn);
  dependsOnRef.current = dependsOn;

  const form = useForm({
    id: "quest-create",
    schema: questCreateSchema.omit({ projectId: true, dependsOn: true }),
    initialValues: {
      ...(props.quest as QuestResource),
      priority: props.quest?.priority ?? "optional",
    },
    handler: async (data) => {
      if (props.quest?.id) {
        const resp = await questApi.updateQuestById({
          params: { id: props.quest.id },
          // `dependsOn` rides alongside the form data; null clears the link.
          body: { ...data, dependsOn: dependsOnRef.current },
        });
        alepha.store.set(currentAssignedQuestsAtom, [
          resp,
          ...(alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
            (quest) => quest.id !== resp.id,
          ),
        ]);
        props.onSubmit(resp);
        return;
      }

      let quest = await questApi.createQuest({
        body: {
          ...data,
          projectId: props.project.id,
          dependsOn: dependsOnRef.current ?? undefined,
        },
      });

      // A brand-new area declared right here isn't in `currentAreasAtom`
      // yet — that atom is filled only by the `project` route loader, and
      // neither the navigation below nor the kanban `onCreated` callback
      // re-enters it. Left alone, the area stays missing from every
      // picker (this form, the quests-table filter, the kanban filter)
      // for the rest of the session — this is literally how `folio` vs
      // `Folio` was born. The rename dialog gets this for free via
      // `force: true` on its post-rename push (see
      // `ProjectSettingsAreaPage.tsx`); create has no equivalent
      // navigation to piggyback on, so refetch directly instead.
      if (
        quest.area &&
        !(alepha.store.get(currentAreasAtom) ?? []).some(
          (a) => a.name === quest.area,
        )
      ) {
        const refreshedAreas = await areaApi.getAreas({
          params: { projectId: props.project.id },
        });
        alepha.store.set(currentAreasAtom, refreshedAreas);
      }

      if (acceptAfterCreate.current) {
        quest = await questApi.acceptQuest({ params: { id: quest.id } });
      }
      acceptAfterCreate.current = false;

      props.onSubmit(quest);

      if (props.onCreated) {
        props.onCreated(quest);
      } else {
        await router.push("projectQuest", {
          params: {
            projectSlug: props.project.slug,
            shortId: String(quest.shortId),
          },
        });
      }
    },
  });

  const { loading: submitting } = useFormState(form, ["loading"]);

  // Bound once so the editor keeps its identity across the form's renders —
  // see `useLoreEditorControl`, which exists for exactly that.
  const DescriptionEditor = useLoreEditorControl({
    kind: "quest",
    projectId: props.project.id,
    projectSlug: props.project.slug,
    id: props.quest?.id,
  });

  const areas = (currentAreas ?? []).map((a) => a.name);

  return (
    <form {...form.props} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Control
            label={tr("quest.create.title")}
            description={tr("quest.create.title.helper")}
            input={form.input.title}
            icon={Tag}
          />
          <Control
            label={tr("quest.create.area")}
            description={tr("quest.create.area.helper")}
            input={form.input.area}
            icon={Tent}
            combobox
            createNewEntry
            items={areas}
          />
        </div>

        <Control
          label={tr("quest.create.description")}
          description={tr("quest.create.description.helper")}
          input={form.input.description}
          icon={FileText}
          custom={DescriptionEditor as never}
        />

        <Separator />

        <Control
          input={form.input.priority}
          label={tr("quest.create.priority")}
          description={tr("quest.create.priority.helper")}
          segmented
        />

        {/* Estimation is a methodology, not a default — see
            `projectFeaturesSchema.questEstimate`. With the switch off the
            field is not rendered, but a stored estimate still rides along
            in `initialValues` and is submitted untouched, so turning the
            switch back on shows the old value rather than a blank. */}
        {questEstimateEnabled && (
          <Control
            label={tr("quest.create.estimate")}
            description={tr("quest.create.estimate.helper")}
            input={form.input.estimateMinutes}
            icon={Hourglass}
            custom={QuestEstimateInput as never}
          />
        )}

        <Control
          label={tr("quest.create.tags")}
          description={tr("quest.create.tags.helper")}
          input={form.input.tags}
          icon={TagsIcon}
          custom={
            ((p: { value?: string[]; onChange?: (v: string[]) => void }) => (
              <QuestTagInput
                value={p.value}
                onChange={p.onChange}
                projectId={props.project.id}
              />
            )) as never
          }
        />

        <Control
          label={tr("quest.create.objectives")}
          description={tr("quest.create.objectives.helper")}
          input={form.input.objectives}
          icon={ListChecks}
          custom={QuestCreateObjectives as never}
        />

        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="text-muted-foreground size-4" />
            {tr("quest.create.dependsOn")}
          </span>
          <QuestDependencyPicker
            projectId={props.project.id}
            value={dependsOn}
            onChange={setDependsOn}
            excludeQuestId={props.quest?.id}
          />
          <span className="text-muted-foreground text-xs">
            {tr("quest.create.dependsOn.helper")}
          </span>
        </div>
      </div>

      <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
        {update ? (
          <Button type="submit" disabled={submitting}>
            <Save className="size-4" />
            {tr("quest.create.update")}
          </Button>
        ) : (
          <div className="flex items-stretch">
            <Button
              type="submit"
              disabled={submitting}
              className="rounded-r-none"
            >
              <Plus className="size-4" />
              {tr("quest.create.submit")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    disabled={submitting}
                    aria-label={tr("quest.create.submitAndAccept")}
                    className="border-primary-foreground/20 -ml-px rounded-l-none border-l px-2"
                  />
                }
              >
                <ChevronDown className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    acceptAfterCreate.current = true;
                    void form.submit();
                  }}
                >
                  <Signature className="size-4" />
                  {tr("quest.create.submitAndAccept")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </form>
  );
};

export default QuestCreate;
