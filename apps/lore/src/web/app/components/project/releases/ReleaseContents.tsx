import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Lock, X } from "lucide-react";
import { useMemo } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { ReleaseContentQuest } from "@/api/schemas/releaseContentQuestSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
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
   * Fires after a detach, so the shell refetches the contents, the release
   * rollup and the changelog together. Attaching used to fire it too; it now
   * happens on the work's own surfaces, which this page never sees.
   */
  onChanged: () => void;
}

export interface ReleaseContentsEpic {
  id: number;
  number: number;
  title: string;
  status: string;
  /**
   * The predecessor epic's id, when set. Read by the Flow tab only, which
   * draws it as the edge between two clusters when both are in this
   * release. A predecessor outside the release is laid out as a root.
   */
  dependsOn?: number;
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
  const [areas] = useStore(currentAreasAtom);
  const count = useCountLabel();
  const epicApi = useClient<EpicController>();

  // A published release is frozen for everyone, and a rank that cannot update
  // an epic is read-only on an open one - so both collapse into the flag the
  // detach button below reads.
  //
  // ⚠️ `updateQuestById` is deliberately NOT part of this any more. It was,
  // while the header offered Add quest; with that gone the only write left
  // here is detaching an EPIC, and folding a quest permission into it hid
  // Remove from a rank holding `epic:write` without `quest:update`.
  const readOnly = props.readOnly || !epicApi.updateEpic.can();

  const epics = props.contents?.epics ?? [];
  const looseQuests = props.contents?.looseQuests ?? [];

  const areaColor = useMemo(() => new AreaDotColor(areas), [areas]);

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

        {/* Published: say what happened, rather than dropping the Remove
            button from every card below and leaving the reader to notice its
            absence. It earned this line when it hid the two Add buttons that
            used to sit here; those are gone, and the per-card Remove is what
            it now explains.

            `props.readOnly`, not the folded flag below: this line says the
            release is frozen, which is not what a rank without the write
            means. */}
        {props.readOnly && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
            <Lock className="size-3.5" aria-hidden />
            {tr("release.contents.frozen")}
          </span>
        )}

        {/* Adding from the release side is gone (#Q2113). A release is
            filled from the work: the epic page and the quest rail carry the
            control, and both tables carry it in the row menu (#Q2098). This
            header used to hold a second door to the same write path, which
            made the release read as the place a release is assembled.

            Removing (below, per card) stays: detaching from the release side
            is the one direction that has nowhere else to live. */}
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
              {!readOnly && (
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
