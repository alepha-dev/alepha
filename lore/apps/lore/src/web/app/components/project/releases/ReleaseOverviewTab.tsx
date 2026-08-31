import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Button } from "@alepha/ui/components/ui/button";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CalendarClock, Gauge, Package, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { releaseBuckets } from "./releaseBuckets.ts";
import { useCountLabel } from "./useCountLabel.ts";

export interface ReleaseOverviewTabProps {
  release: ReleaseResource;
  artifactCount: number;
  onEdit: () => void;
}

/**
 * The Overview tab: three numbers worth knowing about the release, and the
 * release's own description.
 *
 * Each card answers one question - is it ready, when is it due, what has been
 * built for it - and each says in one line what its number does *not* mean.
 * That second line is the point of the card. `47%` on its own invites the
 * reader to treat a release as a burndown; `47%` under "6 quests still to
 * land, 2 declined as out of scope" does not.
 *
 * **The estimate caveat appears exactly once on this page**, in the Target
 * card. The plate's meta line prints the same date and deliberately says
 * nothing about it.
 */
const ReleaseOverviewTab = (props: ReleaseOverviewTabProps) => {
  const { release } = props;
  const { tr, l } = useI18n<I18n, "en">();
  // ⚠️ Not `Date.now()`. "How many days until the target" is exactly the
  // kind of thing a test pins with `travel()`, and the ban exists so it can.
  const dt = useInject(DateTimeProvider);
  // "6 quests still to land" is the one line on this card a reader acts on.
  const count = useCountLabel();

  const published = !!release.releasedAt;
  const buckets = releaseBuckets(release.progress);

  const readiness = published
    ? tr("release.kpi.ready.frozen")
    : buckets.total === 0
      ? tr("release.progress.none")
      : [
          buckets.remaining > 0
            ? count(
                buckets.remaining,
                "release.kpi.ready.remaining.one",
                "release.kpi.ready.remaining.many",
              )
            : String(tr("release.kpi.ready.allLanded")),
          buckets.shelved > 0 &&
            count(
              buckets.shelved,
              "release.kpi.ready.declined.one",
              "release.kpi.ready.declined.many",
            ),
        ]
          .filter(Boolean)
          .join(" ");

  // Whole days between today and the target, both floored to midnight so a
  // target set for tomorrow reads as "1 day" all of today rather than
  // flipping to "today" at some point this afternoon.
  const daysToTarget = release.targetDate
    ? dt
        .of(release.targetDate)
        .startOf("day")
        .diff(dt.now().startOf("day"), "day")
    : undefined;

  const target =
    daysToTarget === undefined
      ? { value: "—", note: tr("release.kpi.target.none") }
      : daysToTarget < 0
        ? {
            value: String(
              tr("release.kpi.target.late", { args: [String(-daysToTarget)] }),
            ),
            note: tr("release.kpi.target.note", {
              args: [String(l(release.targetDate as string, { date: "ll" }))],
            }),
          }
        : {
            value: String(
              daysToTarget === 0
                ? tr("release.kpi.target.today")
                : tr("release.kpi.target.days", {
                    args: [String(daysToTarget)],
                  }),
            ),
            note: tr("release.kpi.target.note", {
              args: [String(l(release.targetDate as string, { date: "ll" }))],
            }),
          };

  const cards: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
    note: string;
  }> = [
    {
      icon: Gauge,
      label: String(tr("release.kpi.ready.label")),
      value: `${buckets.percent}%`,
      note: String(readiness),
    },
    published
      ? {
          icon: CalendarClock,
          label: String(tr("release.kpi.shipped.label")),
          value: String(l(release.releasedAt as string, { date: "MMM D" })),
          note: String(
            tr("release.kpi.shipped.note", {
              args: [String(l(release.releasedAt as string, { date: "ll" }))],
            }),
          ),
        }
      : {
          icon: CalendarClock,
          label: String(tr("release.kpi.target.label")),
          value: target.value,
          note: String(target.note),
        },
    {
      icon: Package,
      label: String(tr("release.kpi.artifacts.label")),
      value: String(props.artifactCount),
      // Names the preview here as well as on the tab: a reader who never
      // opens Artifacts would otherwise take this number for a fact.
      note: String(
        props.artifactCount > 0
          ? tr("release.kpi.artifacts.preview", {
              args: [release.tag ?? String(release.number)],
            })
          : tr("release.artifacts.emptyShort", {
              args: [release.tag ?? String(release.number)],
            }),
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[18px] px-6 pt-[22px] pb-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-card border-border flex flex-col gap-[7px] rounded-xl border px-4 py-[14px]"
          >
            <span className="text-muted-foreground flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
              <card.icon className="size-[13px]" aria-hidden />
              {card.label}
            </span>
            <span className="text-[26px] leading-none font-semibold tracking-[-0.02em]">
              {card.value}
            </span>
            <span className="text-muted-foreground text-[11.5px] leading-[1.45]">
              {card.note}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.09em] uppercase">
            {tr("release.description.label")}
          </span>
          <div className="bg-border h-px flex-1" />
          {!published && (
            <Button variant="ghost" size="sm" onClick={props.onEdit}>
              <Pencil className="size-3.5" />
              {tr("release.detail.edit")}
            </Button>
          )}
        </div>
        <div className="bg-card border-border rounded-xl border px-[18px] py-4">
          {release.description ? (
            // `MarkdownView` directly, not `LoreViewer`. That wrapper resolves
            // `[[…]]` for an `ElementRef`, whose `kind` is folio | quest |
            // epic - and `elementKindSchema` says in as many words that a
            // fourth member of that union is a change nobody should make for
            // a rendering convenience. A release is not an element; it gets
            // markdown without wiki-links.
            <MarkdownView content={release.description} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {tr("release.description.empty")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReleaseOverviewTab;
