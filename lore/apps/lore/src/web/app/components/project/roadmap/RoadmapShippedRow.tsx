import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { RoadmapRelease } from "@/api/schemas/roadmapReleaseSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface RoadmapShippedRowProps {
  release: RoadmapRelease;
  member: boolean;
}

/**
 * One shipped release, collapsed to a line: its tag, its title, and when it
 * landed.
 *
 * No progress bar. A published release renders entirely from the four counts
 * frozen onto its row and lists no epics here (see `roadmapReleaseSchema`),
 * and a bar reading 100% for every finished release says nothing the date
 * beside it does not. The question a shipped release answers is "when".
 *
 * ⚠️ **The link is member-only, and that is not a courtesy.** The release
 * detail page and its frozen changelog live under `/:projectSlug`, which
 * carries `$secure()` - so offering the link to a stranger reading a public
 * roadmap sends them to a login screen they have no account for. `member`
 * comes from the endpoint (`memberRoadmapResourceSchema`) rather than from
 * "the member endpoint answered", because a signed-in stranger reading a
 * public roadmap takes that path too.
 */
const RoadmapShippedRow = (props: RoadmapShippedRowProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const router = useRouter<AppRouter>();
  const { release } = props;

  const tag = release.tag ?? release.title;
  const when = release.releasedAt
    ? tr("roadmap.release.released", {
        args: [String(i18n.l(release.releasedAt, { date: "ll" }))],
      })
    : "";

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
      {props.member && release.tag ? (
        <Link
          href={router.path("projectRelease", {
            params: { releaseTag: release.tag },
          })}
          className="font-mono text-sm font-medium"
        >
          {tag}
        </Link>
      ) : (
        <span className="font-mono text-sm font-medium">{tag}</span>
      )}
      {release.title && release.title !== release.tag ? (
        <span className="text-muted-foreground text-sm">{release.title}</span>
      ) : null}
      <span className="text-muted-foreground ml-auto text-xs">{when}</span>
    </div>
  );
};

export default RoadmapShippedRow;
