import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { RoadmapRelease } from "@/api/schemas/roadmapReleaseSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { releaseBuckets } from "@/web/app/components/project/releases/releaseBuckets.ts";
import ReleaseProgressBar from "@/web/app/components/project/releases/ReleaseProgressBar.tsx";
import type { I18n } from "@/web/app/services/I18n.ts";

import RoadmapEpicRow from "./RoadmapEpicRow.tsx";

export interface RoadmapReleaseCardProps {
  release: RoadmapRelease;
  /**
   * Whether the viewer belongs to this project. Gates the link on the tag and
   * nothing else - the card's content is identical for every audience.
   */
  member: boolean;
}

/**
 * One release on the roadmap: its tag, what it is for, when it is meant to
 * land, how far along it is, and the epics inside it.
 *
 * Deliberately **not** the releases list row with a different stylesheet. The
 * list is a work surface with edit controls and a link into each release; this
 * is a read surface whose job is to be legible to someone who does not use
 * Lore daily, and who may not be signed in at all.
 *
 * ⚠️ **"Estimated", never "due".** Nothing enforces `targetDate` and no cron
 * reads it - that is the whole difference from the auto-close deadline the
 * milestone recorder carried. The wording is the only thing stopping it
 * becoming a promise, so it is not a phrasing preference.
 */
const RoadmapReleaseCard = (props: RoadmapReleaseCardProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const router = useRouter<AppRouter>();
  const { release } = props;
  const buckets = releaseBuckets(release.progress);

  const when = release.releasedAt
    ? tr("roadmap.release.released", {
        args: [String(i18n.l(release.releasedAt, { date: "ll" }))],
      })
    : release.targetDate
      ? tr("roadmap.release.estimated", {
          args: [String(i18n.l(release.targetDate, { date: "ll" }))],
        })
      : tr("roadmap.release.noDate");

  return (
    <article className="bg-card border-border flex flex-col gap-4 rounded-xl border px-5 py-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* The tag is the release's identity, so it leads. `title` defaults
              to the tag server-side, and repeating it would be noise.

              ⚠️ The link is member-only. The release detail page lives under
              `/:projectSlug`, which carries `$secure()`, so offering it to a
              stranger reading a public roadmap sends them to a login screen
              they have no account for. */}
          <h3 className="font-mono text-base font-semibold">
            {props.member && release.tag ? (
              <Link
                href={router.path("projectRelease", {
                  params: { releaseTag: release.tag },
                })}
              >
                {release.tag}
              </Link>
            ) : (
              (release.tag ?? release.title)
            )}
          </h3>
          {release.title && release.title !== release.tag ? (
            <span className="text-muted-foreground text-sm">
              {release.title}
            </span>
          ) : null}
        </div>
        <span className="text-muted-foreground text-xs">{when}</span>
      </header>

      {release.description ? (
        // `MarkdownView` directly rather than `LoreViewer`: that wrapper
        // resolves `[[…]]` into links to folios, quests and epics, every one
        // of which is member-gated. A roadmap must not sprout links a reader
        // of this page cannot follow.
        <div className="text-sm">
          <MarkdownView content={release.description} />
        </div>
      ) : null}

      <ReleaseProgressBar buckets={buckets} />

      {release.epics.length > 0 ? (
        <div className="flex flex-col gap-3">
          {release.epics.map((epic) => (
            <RoadmapEpicRow key={epic.number} epic={epic} />
          ))}
        </div>
      ) : null}
    </article>
  );
};

export default RoadmapReleaseCard;
