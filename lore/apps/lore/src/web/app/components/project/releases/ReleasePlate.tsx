import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  CalendarCheck,
  Layers,
  Package,
  Pencil,
  RotateCcw,
  Send,
  Swords,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";
import { releaseBuckets } from "./releaseBuckets.ts";
import ReleaseProgressBar from "./ReleaseProgressBar.tsx";
import {
  releaseState,
  STATE_ICONS,
  STATE_LABEL_KEYS,
  STATE_TONE,
} from "./releaseState.ts";
import { useCountLabel } from "./useCountLabel.ts";

export interface ReleasePlateProps {
  release: ReleaseResource;
  /**
   * Counted from the Contents endpoint, so the meta line and the Contents
   * tab can never disagree about how many epics are in this release.
   */
  epicCount: number;
  /**
   * Counted from the artifact list the Artifacts tab renders. A count, not a
   * readiness ratio: an artifact is present or absent and has no other state.
   */
  artifactCount: number;
  onEdit: () => void;
  onChanged: () => void;
}

/**
 * The release's identity band: what this release is, how far along it is, and
 * the two things you can do to it.
 *
 * A full-width horizontal plate rather than `DetailLayout`'s 288px identity
 * aside, which the Epic page uses. A release's identity is four facts wide
 * and no facts deep, and the tab bodies below - an artifact table, epic cards
 * carrying every quest - all want the full frame. A column would spend a
 * quarter of the width to print a tag and a date.
 *
 * Every fact on the meta line is backed by a surface on this page: the date
 * by the Target card, the epics and quests by Contents, the artifacts by
 * Artifacts. **There is no deployment fact here.** An earlier draft had a
 * Deployments tab and a "furthest environment" entry; both were cut, and
 * putting the environment back in this line would be the tab returning
 * through the side door.
 */
const ReleasePlate = (props: ReleasePlateProps) => {
  const { release } = props;
  const { tr, l } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const releaseApi = useClient<ReleaseController>();
  // Three counts on one line: "(s)" would be the loudest thing on it.
  const count = useCountLabel();
  const [submitting, setSubmitting] = useState(false);

  const published = !!release.releasedAt;
  const state = releaseState(release);
  const StateIcon = STATE_ICONS[state];
  const buckets = releaseBuckets(release.progress);

  const publish = async () => {
    const ok = await dialog.confirm({
      title: String(tr("release.publish.title")),
      description: String(
        tr("release.publish.description", {
          args: [release.tag ?? String(release.number)],
        }),
      ),
      confirmLabel: String(tr("release.publish.confirm")),
      cancelLabel: String(tr("common.cancel")),
      destructive: true,
    });
    if (!ok || submitting) return;
    setSubmitting(true);
    try {
      await releaseApi.publishRelease({
        params: { id: release.id },
        body: {},
      });
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const reopen = async () => {
    const ok = await dialog.confirm({
      title: String(tr("release.reopen.title")),
      description: String(tr("release.reopen.description")),
      confirmLabel: String(tr("release.reopen.confirm")),
      cancelLabel: String(tr("common.cancel")),
      destructive: true,
    });
    if (!ok || submitting) return;
    setSubmitting(true);
    try {
      await releaseApi.reopenRelease({ params: { id: release.id } });
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const meta: Array<{ icon: LucideIcon; text: string; divide?: boolean }> = [
    {
      icon: published ? CalendarCheck : Target,
      // Just the date. The caveat that a target is only an estimate is said
      // once on this page, in the Target card on Overview, and repeating it
      // here would make the densest line the wordiest.
      text: published
        ? String(
            tr("release.meta.released", {
              args: [String(l(release.releasedAt as string, { date: "ll" }))],
            }),
          )
        : release.targetDate
          ? String(
              tr("release.meta.target", {
                args: [String(l(release.targetDate, { date: "ll" }))],
              }),
            )
          : String(tr("release.list.noTarget")),
      divide: true,
    },
    {
      icon: Layers,
      text: count(
        props.epicCount,
        "release.meta.epics.one",
        "release.meta.epics.many",
      ),
    },
    {
      icon: Swords,
      // `total`, matching the ratio in the card to the right of it. Declined
      // work is outside that denominator and is reported by the bar's own
      // tooltip rather than by a second count here that would not add up
      // against the one beside it.
      text: count(
        buckets.total,
        "release.meta.quests.one",
        "release.meta.quests.many",
      ),
    },
    {
      icon: Package,
      text: count(
        props.artifactCount,
        "release.meta.artifacts.one",
        "release.meta.artifacts.many",
      ),
      divide: true,
    },
  ];

  return (
    <div className="flex flex-wrap items-start gap-5 px-6 pt-[22px] pb-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-3">
          {/* The tag is the release's identity AND the join key to its
              artifacts, so it gets display weight rather than the small
              secondary badge it used to wear. */}
          <span className="bg-muted border-border flex h-8 items-center rounded-lg border px-3 font-mono text-[19px] font-semibold tracking-[-0.01em]">
            {release.tag ?? formatReference("release", release.number)}
          </span>
          {/* The SAME chip the Releases table draws, from the same three
              tables in `releaseState.ts`. The design called for a green
              "Open" and a grey "Released"; that would have been a second
              vocabulary and a second palette for a state the list already
              names, and the two surfaces disagreeing about one release is
              worse than either choice on its own. */}
          <Badge variant="tint" tone={STATE_TONE[state]}>
            <StateIcon className="size-3" />
            {tr(STATE_LABEL_KEYS[state])}
          </Badge>
          {/* Printed only when it says something the tag does not: `title`
              is NOT NULL and defaults to the tag server-side, so most
              releases have one that is a duplicate. */}
          {release.title && release.title !== release.tag && (
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">
              {release.title}
            </h1>
          )}
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
          {meta.map((entry, index) => (
            <span key={entry.text} className="flex items-center gap-4">
              {/* A rule between GROUPS, not between every pair: the date is
                  one fact, the three counts are one set. */}
              {index > 0 && entry.divide && (
                <span className="bg-border h-3.5 w-px" aria-hidden />
              )}
              <span className="flex items-center gap-1.5">
                <entry.icon className="size-[13px] shrink-0" aria-hidden />
                {entry.text}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="bg-card border-border flex w-70 shrink-0 flex-col gap-2 rounded-[10px] border px-[14px] py-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
            {/* A published release's counts are the record of what shipped,
                not a live measure, and the label is where that is said. */}
            {published
              ? tr("release.plate.frozen")
              : tr("release.hero.progress")}
          </span>
          <span className="font-mono text-xs font-semibold">
            {buckets.completed}/{buckets.total}
          </span>
        </div>
        <ReleaseProgressBar buckets={buckets} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Hidden rather than disabled once published. A published release
            is a record: the server refuses every write to it, and an
            affordance that always fails is worse than no affordance. */}
        {!published && (
          <Button variant="outline" size="lg" onClick={props.onEdit}>
            <Pencil className="size-4" />
            {tr("release.detail.edit")}
          </Button>
        )}
        {published ? (
          // Quieter than Publish was, and deliberately not a toggle beside
          // it: reopening is what you do when you published by mistake, and
          // it clears the frozen record.
          <Button
            variant="ghost"
            size="lg"
            disabled={submitting}
            onClick={() => void reopen()}
          >
            <RotateCcw className="size-4" />
            {tr("release.reopen.action")}
          </Button>
        ) : (
          <Button
            size="lg"
            disabled={submitting}
            onClick={() => void publish()}
          >
            <Send className="size-4" />
            {tr("release.publish.action")}
          </Button>
        )}
      </div>
    </div>
  );
};

export default ReleasePlate;
