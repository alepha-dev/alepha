import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Lock, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { ReleaseContentQuest } from "@/api/schemas/releaseContentQuestSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { AreaDotColor } from "../../shared/areaColor.ts";
import { formatReference } from "../../shared/element/typedReference.ts";
import {
  type EpicStatus,
  STATUS_ICONS,
  STATUS_LABEL_KEYS,
  STATUS_TONE,
} from "../epics/epicStatus.ts";
import {
  BUCKET_ORDER,
  type ReleaseBucket,
  questBucket,
} from "./releaseBuckets.ts";
import ReleaseQuestRow from "./ReleaseQuestRow.tsx";
import ReleaseTickBar from "./ReleaseTickBar.tsx";
import { useCountLabel } from "./useCountLabel.ts";

/**
 * The attach picker's one-field form. It holds an id and is emptied again the
 * moment the attach lands, so it is a gesture rather than a value: the field
 * is reset every time the picker opens.
 */
const attachFormSchema = z.object({
  target: z.number().optional(),
});

export interface ReleaseContentsProps {
  releaseId: number;
  /**
   * A published release is a record. Its contents are still listed - that is
   * what it shipped - but nothing offers to change them.
   */
  readOnly: boolean;
  /**
   * What is in the release, fetched by the shell.
   *
   * ⚠️ **This tab does not fetch it, and must not.** The plate's meta line
   * counts these epics and the tab bar counts these rows, and both are on
   * screen while another tab is open - so a fetch owned by this component
   * left the header reading `0 epics` for anyone who deep-linked to
   * `?tab=changelog`. The shell owns the data; this renders it.
   *
   * `null` means "not loaded yet" and renders nothing rather than an empty
   * state: a failed load must not read as a release with nothing in it.
   */
  contents: ReleaseContentsData | null;
  /**
   * Fires after an attach or a detach, so the shell refetches the contents,
   * the release rollup and the changelog together.
   */
  onChanged: () => void;
}

export interface ReleaseContentsEpic {
  id: number;
  number: number;
  title: string;
  status: string;
  quests: ReleaseContentQuest[];
}

export interface ReleaseContentsData {
  epics: ReleaseContentsEpic[];
  looseQuests: ReleaseContentQuest[];
}

/**
 * What is in the release: one card per attached epic carrying its own quests,
 * then the loose quests grouped by the area they were done in.
 *
 * ⚠️ **Every number here is counted from the rows beside it.** The card's
 * ratio and its tick bar are derived from `epic.quests`, the same array the
 * list below renders. This card used to print a server-side `4/7` above a
 * list fetched separately per epic with `getQuests({ epic })` - which is
 * blind to which release each quest names, so the ratio and the list were
 * answering two different questions and disagreed whenever an epic carried a
 * quest belonging elsewhere.
 */
const ReleaseContents = (props: ReleaseContentsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [areas] = useStore(currentAreasAtom);
  const count = useCountLabel();
  const epicApi = useClient<EpicController>();
  const questApi = useClient<QuestController>();

  const epics = props.contents?.epics ?? [];
  const looseQuests = props.contents?.looseQuests ?? [];
  const [attachableEpics, setAttachableEpics] = useState<EpicResource[]>([]);
  const [attachableQuests, setAttachableQuests] = useState<
    Array<{ id: number; shortId: number; title: string }>
  >([]);
  const [adding, setAdding] = useState<"epic" | "quest" | null>(null);

  const areaColor = useMemo(() => new AreaDotColor(areas), [areas]);

  const attachForm = useForm({
    schema: attachFormSchema,
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, value) => {
      const id = value as number | undefined;
      if (id == null) return;
      void (adding === "epic" ? attachEpic(id) : attachQuest(id));
    },
  });

  // The picker is one control serving two lists, and it outlives both: the
  // form lives on this component while the `<Control>` only renders while
  // `adding` is set. Without this it reopens still showing the last thing
  // attached.
  const resetAttachForm = () => {
    attachForm.setInitialValues({ target: undefined }, { keepDirty: false });
  };

  const openAddEpic = async () => {
    if (!project) return;
    resetAttachForm();
    setAdding("epic");
    try {
      const all = await epicApi.getEpics({ params: { projectId: project.id } });
      // Only epics that are in NO release: an epic belongs to at most one, so
      // offering one that is already placed would silently move it out of
      // wherever it was.
      setAttachableEpics(all.filter((epic) => epic.releaseId == null));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      setAdding(null);
    }
  };

  const openAddQuest = async () => {
    if (!project) return;
    resetAttachForm();
    setAdding("quest");
    try {
      // Open quests only, and only ones not already in a release. A completed
      // quest can be attached from its own page, but offering it here would
      // suggest a release is a place to file finished work.
      const page = await questApi.getQuests({
        params: { projectId: project.id },
        query: { status: "new", size: 50 } as never,
      });
      setAttachableQuests(
        (
          page.content as never as Array<{
            id: number;
            shortId: number;
            title: string;
            releaseId?: number;
          }>
        ).filter((quest) => quest.releaseId == null),
      );
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      setAdding(null);
    }
  };

  const attachQuest = async (questId: number) => {
    try {
      await questApi.updateQuestById({
        params: { id: questId },
        body: { releaseId: props.releaseId },
      });
      setAdding(null);
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const attachEpic = async (epicId: number) => {
    try {
      await epicApi.updateEpic({
        params: { id: epicId },
        body: { releaseId: props.releaseId },
      });
      setAdding(null);
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const detachEpic = async (epicId: number) => {
    try {
      await epicApi.updateEpic({
        params: { id: epicId },
        body: { releaseId: null },
      });
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const byArea = new Map<string, ReleaseContentQuest[]>();
  for (const quest of looseQuests) {
    const area = quest.area || String(tr("release.contents.uncategorized"));
    const list = byArea.get(area) ?? [];
    list.push(quest);
    byArea.set(area, list);
  }

  return (
    <div className="flex flex-col gap-4 px-6 pt-[22px] pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.09em] uppercase">
          {tr("release.contents.title")}
        </span>
        <span className="text-muted-foreground text-[11.5px]">
          {[
            count(
              epics.length,
              "release.contents.note.epics.one",
              "release.contents.note.epics.many",
            ),
            count(
              looseQuests.length,
              "release.contents.note.loose.one",
              "release.contents.note.loose.many",
            ),
          ].join(", ")}
        </span>
        <div className="flex-1" />

        {/* Published: say what happened, rather than hiding two buttons and
            leaving the reader to notice their absence. */}
        {props.readOnly && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
            <Lock className="size-3.5" aria-hidden />
            {tr("release.contents.frozen")}
          </span>
        )}

        {/* Attaching from the release side. The write path is the same one
            the epic page and the quest rail use; this is a second door to
            it, not a second path. */}
        {!props.readOnly && adding === null && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openAddEpic()}
            >
              <Plus className="size-3.5" />
              {tr("release.contents.addEpic")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openAddQuest()}
            >
              <Plus className="size-3.5" />
              {tr("release.contents.addQuest")}
            </Button>
          </>
        )}
        {!props.readOnly && adding !== null && (
          <div className="flex items-center gap-2">
            <Control
              input={attachForm.input.target}
              label=""
              placeholder={String(
                tr(
                  adding === "epic"
                    ? "release.contents.pickEpic"
                    : "release.contents.pickQuest",
                ),
              )}
              inputProps={{
                "aria-label": String(
                  tr(
                    adding === "epic"
                      ? "release.contents.addEpic"
                      : "release.contents.addQuest",
                  ),
                ),
              }}
              triggerClassName="h-8 w-56"
              items={
                adding === "epic"
                  ? attachableEpics.map((epic) => ({
                      value: String(epic.id),
                      label: `${formatReference("epic", epic.number)} ${epic.title}`,
                    }))
                  : attachableQuests.map((quest) => ({
                      value: String(quest.id),
                      label: `${formatReference("quest", quest.shortId)} ${quest.title}`,
                    }))
              }
            />
            <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>
              {tr("common.cancel")}
            </Button>
          </div>
        )}
      </div>

      {props.contents && epics.length === 0 && looseQuests.length === 0 && (
        <p className="text-muted-foreground text-[13px]">
          {tr("release.contents.empty")}
        </p>
      )}

      {epics.map((epic) => {
        // Counted from the rows this card is about to render, sorted into
        // the plate's own bucket order so the two bars read the same way.
        const buckets: ReleaseBucket[] = epic.quests.map(questBucket);
        const ordered = BUCKET_ORDER.flatMap((bucket) =>
          buckets.filter((b) => b === bucket),
        );
        const completed = buckets.filter((b) => b === "completed").length;
        // Shelved is outside the denominator here for the same reason it is
        // on the release rollup: declined work is not work outstanding.
        const total = buckets.filter((b) => b !== "shelved").length;
        // `getReleaseContents` types this as a plain string; the three
        // values it can hold are the epic status enum.
        const status = epic.status as EpicStatus;
        const StatusIcon = STATUS_ICONS[status];

        return (
          <div
            key={epic.id}
            className="bg-card border-border overflow-hidden rounded-xl border"
          >
            <div className="flex items-center gap-3 px-[15px] py-[13px]">
              <Badge variant="tint" tone={STATUS_TONE[status]}>
                {StatusIcon && <StatusIcon className="size-3" />}
                {tr(STATUS_LABEL_KEYS[status])}
              </Badge>
              <Link
                href={router.path("projectEpic", {
                  params: { epicNumber: String(epic.number) },
                })}
                className="min-w-0 flex-1 truncate text-sm font-medium"
              >
                {/* Only the separator is muted, so the ref and the title read
                    as one name rather than two fields. */}
                <span className="font-mono">
                  {formatReference("epic", epic.number)}
                </span>
                <span className="text-muted-foreground"> - </span>
                {epic.title}
              </Link>
              <ReleaseTickBar buckets={ordered} />
              <span className="text-muted-foreground shrink-0 font-mono text-[11.5px]">
                {completed}/{total}
              </span>
              {!props.readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={String(tr("release.contents.remove"))}
                  onClick={() => void detachEpic(epic.id)}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="border-border/60 border-t px-2 pt-1.5 pb-2">
              {epic.quests.map((quest) => (
                <ReleaseQuestRow key={quest.id} quest={quest} />
              ))}
            </div>
          </div>
        );
      })}

      {[...byArea].map(([area, quests]) => (
        <div
          key={area}
          className="bg-card border-border rounded-xl border px-[15px] py-[14px]"
        >
          <div className="mb-1.5 flex items-center gap-2.5">
            {/* The area's own colour as a dot, the way every other Lore
                surface renders one. Deliberately not a filled chip: the
                chip palette (`TAG_CHIP_CLASS`) belongs to project TAGS, and
                a second one for areas is exactly the invented palette
                `areaColor.ts` exists to prevent. */}
            <span
              className={`size-2 shrink-0 rounded-full ${areaColor.dotClass(area)}`}
              aria-hidden
            />
            <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.06em] uppercase">
              {area}
            </span>
            <span className="text-muted-foreground text-[11px]">
              {quests.length}
            </span>
            <div className="bg-border h-px flex-1" />
            <span className="text-muted-foreground text-[11px]">
              {tr("release.contents.noEpic")}
            </span>
          </div>
          {quests.map((quest) => (
            <ReleaseQuestRow key={quest.id} quest={quest} />
          ))}
        </div>
      ))}
    </div>
  );
};

export default ReleaseContents;
