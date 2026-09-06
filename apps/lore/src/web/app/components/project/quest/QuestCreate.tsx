import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  ChevronDown,
  FileText,
  Flag,
  CalendarClock,
  Hourglass,
  ListChecks,
  Paperclip,
  Plus,
  Save,
  Signature,
  SlidersHorizontal,
  Tag,
  Tags as TagsIcon,
  Tent,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import { questCreateSchema } from "@/api/schemas/questCreateSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { capabilityOption } from "../../../services/projectCapabilities.ts";
import CollapsibleBlock from "../../shared/CollapsibleBlock.tsx";
import { useLoreEditorControl } from "../../shared/element/useLoreEditorControl.ts";
import QuestAttachments from "./QuestAttachments.tsx";
import QuestCreateObjectives from "./QuestCreateObjectives.tsx";
import QuestDependencyPicker from "./QuestDependencyPicker.tsx";
import QuestEstimateInput from "./QuestEstimateInput.tsx";
import { DEFAULT_QUEST_SIZE, QUEST_SIZE_OPTIONS } from "./questSize.ts";

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
  const dt = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [currentAreas] = useStore(currentAreasAtom);
  const [releases] = useStore(currentReleasesAtom);

  const questEstimateEnabled = capabilityOption(
    props.project,
    "work",
    "estimate",
  );

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

  // The project's existing tags, offered as the Tags select's options. Fetched
  // here rather than inside a widget because the field is a plain multi-select
  // `Control` now, and `items` is what feeds it.
  const [knownTags, setKnownTags] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    questApi
      .listQuestTags({ query: { projectId: props.project.id } })
      .then((tags) => {
        if (alive) setKnownTags(tags);
      })
      .catch(() => {
        // Suggestions are a convenience, not the feature: `createNewEntry`
        // means the field still accepts any tag with an empty option list, so
        // a failed fetch must not cost the form.
      });
    return () => {
      alive = false;
    };
  }, [props.project.id]);

  const form = useForm({
    id: "quest-create",
    schema: questCreateSchema
      .omit({ projectId: true, dependsOn: true })
      // Size is optional on the wire (Lore's own programmatic creators have
      // no basis for a value) but mandatory here, where a human is looking
      // straight at the control. `initialValues` seeds M, so it is never
      // actually empty; the override exists to draw the required marker.
      .extend({
        size: z.integer().min(1).max(5),
        // ⚠️ `YYYY-MM-DD` in the FORM, an instant on the WIRE.
        //
        // The column and `questCreateSchema` are both datetime, and the
        // handler below converts. The field is date-only because nothing in
        // Lore reads a time-of-day deadline, and because day-granularity has
        // to be stored as the END of the chosen day or "due Friday" is
        // overdue at 00:01 on Friday (quest #1521).
        //
        // Declaring it here rather than forcing `date` on the Control is what
        // makes `ControlDate` parse and format it locally: given a datetime
        // schema it would store the picked instant and lose the end-of-day
        // rule silently.
        dueAt: z.date().nullable().optional(),
      }),
    initialValues: {
      ...(props.quest as QuestResource),
      priority: props.quest?.priority ?? "optional",
      size: props.quest?.size ?? DEFAULT_QUEST_SIZE,
      // The stored instant, as the day it falls on in the reader's own
      // timezone. Never `toISOString().slice(0, 10)`, which shifts the day
      // backwards west of UTC - the classic way a deadline moves.
      dueAt: props.quest?.dueAt
        ? dt.of(props.quest.dueAt).format("YYYY-MM-DD")
        : undefined,
    },
    handler: async (input) => {
      // The form's date-only `dueAt` becomes the instant the API stores: the
      // END of the chosen day, in local time. `null` rather than `undefined`
      // when it is cleared, because the ORM update layer drops an undefined
      // key (`"dueAt" in body` reads false) and the old deadline would
      // silently survive.
      const data = {
        ...input,
        dueAt: input.dueAt
          ? dt.of(input.dueAt).endOf("day").toDate().toISOString()
          : null,
      };

      if (props.quest?.id) {
        const resp = await questApi.updateQuestById({
          params: { id: props.quest.id },
          // `dependsOn` rides alongside the form data; null clears the link.
          body: { ...data, dependsOn: dependsOnRef.current },
        });
        // Replace in place only: the atom holds the viewer's accepted quests,
        // and prepending used to put any edited quest in the Quest Log.
        alepha.store.set(
          currentAssignedQuestsAtom,
          (alepha.store.get(currentAssignedQuestsAtom) ?? []).map((quest) =>
            quest.id === resp.id ? resp : quest,
          ),
        );
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

  // No `questId` on create: the quest does not exist yet, so the chips run
  // on the metadata seeded at upload time. On edit it is passed, and the
  // server fills in names for attachments from earlier sessions.
  const AttachmentsField = useMemo(
    () =>
      (fieldProps: { value?: string[]; onChange?: (v: string[]) => void }) => (
        <QuestAttachments
          questId={props.quest?.id}
          value={fieldProps.value ?? []}
          onChange={(next) => fieldProps.onChange?.(next)}
        />
      ),
    [props.quest?.id],
  );

  const areas = (currentAreas ?? []).map((a) => a.name);

  // Does the quest we opened with already carry anything from the Advanced
  // section? Computed from `props.quest` and not from live form state, since
  // `defaultOpen` is only read on mount - reopening on every keystroke would
  // fight whoever just collapsed the section by hand. `estimateMinutes` is
  // tested against 0 rather than null because the handler reads any
  // non-positive value as "no estimate".
  const q = props.quest;
  const hasAdvancedValues =
    (q?.tags?.length ?? 0) > 0 ||
    (q?.estimateMinutes ?? 0) > 0 ||
    q?.dueAt != null ||
    (q?.objectives?.length ?? 0) > 0 ||
    q?.dependsOn != null ||
    q?.releaseId != null;

  const releasesEnabled = props.project.features?.milestones === true;
  const releaseOptions = (releases ?? [])
    .filter((r) => !r.releasedAt || r.id === props.quest?.releaseId)
    .map((r) => ({ value: String(r.id), label: r.tag ?? r.title }));

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

        {/* Below the description, because that is what an attachment is
            attached TO: a screenshot of the bug the description describes.
            Bound once for the same reason the editor above is — a component
            rebuilt each render remounts its file input and loses the drag
            state mid-drop. */}
        <Control
          label={tr("quest.view.attachments")}
          input={form.input.attachments}
          icon={Paperclip}
          custom={AttachmentsField as never}
        />

        {/* Priority and Size share a row, the same 50/50 the Name and Area
            pair above uses. They answer the two halves of "where does this
            sit": how urgent it is, and how big it is. Both are mandatory and
            both always render, so the grid is unconditional here. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Control
            input={form.input.priority}
            label={tr("quest.create.priority")}
            description={tr("quest.create.priority.helper")}
            segmented
          />

          {/* The stored value is the ordinal 1-5; `items` supplies the
              t-shirt labels the reader actually picks from. `ControlSelect`
              matches options on strings and coerces back to a number
              because the bound schema is an integer, so the form submits
              `3`, not `"3"`. */}
          <Control
            input={form.input.size}
            label={tr("quest.create.size")}
            description={tr("quest.create.size.helper")}
            segmented
            items={QUEST_SIZE_OPTIONS}
          />
        </div>

        {/* Everything below the fold is optional trimming rather than part of
            how the quest is framed, so it opens only when it has something to
            show. `defaultOpen` is read from the INITIAL values rather than
            from `update`: a duplicate is a create (no `id`) that arrives
            carrying the source quest's objectives, and keying on edit-mode
            alone would hide them. A blank create has none of these, so it
            still starts collapsed. */}
        <CollapsibleBlock
          icon={<SlidersHorizontal className="size-5" />}
          label={tr("quest.create.advanced")}
          defaultOpen={hasAdvancedValues}
        >
          <div className="flex flex-col gap-4">
            {/* Tags, Estimate and Due date share the first row of the
                section.

                The grid is always on, and the column count follows how many
                fields actually render. It used to be applied only with
                Estimate enabled, to avoid leaving Tags in a half-width column
                with dead space beside it - but that put Due date alone on a
                second row in both configurations, which is what was reported.
                With Due date filling the second column there is no dead space
                to avoid. */}
            <div
              className={
                questEstimateEnabled
                  ? "grid grid-cols-1 gap-3 md:grid-cols-3"
                  : "grid grid-cols-1 gap-3 md:grid-cols-2"
              }
            >
              {/* A plain multi-select, not the bespoke chips widget it used
                  to be: `tags` is an array field, which is the whole of the
                  multi-select API, and `createNewEntry` covers the one thing
                  a stock select could not do — name a tag that does not exist
                  yet. It also earns the popup's search field, which a
                  four-row list would not get.

                  What this drops is the "Reuse:" wall of every tag in the
                  project, printed under the input and growing without bound.
                  The same list is the dropdown now, searchable, and it no
                  longer sets the height of the section. */}
              <Control
                label={tr("quest.create.tags")}
                description={tr("quest.create.tags.helper")}
                input={form.input.tags}
                icon={TagsIcon}
                createNewEntry
                items={knownTags}
                clearLabel={tr("quest.create.tags.empty")}
                countLabel={(n) =>
                  String(tr("quest.create.tagCount", { args: [String(n)] }))
                }
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

              {/* A deadline, not a duration — `estimateMinutes` above answers
              "how long", this answers "by when". Ungated: unlike estimation,
              a due date is not a methodology anyone has to opt into. */}
              <Control
                label={tr("quest.create.due")}
                description={tr("quest.create.due.helper")}
                input={form.input.dueAt}
                icon={CalendarClock}
                clearable
              />
            </div>

            <Control
              label={tr("quest.create.objectives")}
              description={tr("quest.create.objectives.helper")}
              input={form.input.objectives}
              icon={ListChecks}
              custom={QuestCreateObjectives as never}
            />

            <div className="flex flex-col gap-1.5">
              {/* No glyph beside the label: every icon in this form sits
                  inside its input, and the picker below carries this one. */}
              <span className="text-sm font-medium">
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

            {/* Which release this ships in. Optional, and offered only when the
            module is on. Only OPEN releases are listed, plus the quest's own
            current one so editing a quest that already shipped does not read
            as though its release were lost. `clearable` is what puts the
            quest back outside every release.

            Sits last, next to Depends On: both answer "what is this quest
            attached to" rather than what it is, and both are pickers over
            other records. `select` is explicit because `releaseId` is an
            integer, and `Control` resolves a numeric schema to a number
            input before it ever looks at `items`. */}
            {releasesEnabled && releaseOptions.length > 0 && (
              <Control
                input={form.input.releaseId}
                label={tr("quest.create.release")}
                description={tr("quest.create.release.helper")}
                icon={Flag}
                select
                clearable
                items={releaseOptions}
              />
            )}
          </div>
        </CollapsibleBlock>
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
