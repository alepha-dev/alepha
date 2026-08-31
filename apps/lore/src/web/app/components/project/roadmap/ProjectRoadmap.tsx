import { useI18n } from "alepha/react/i18n";

import type { RoadmapResource } from "@/api/schemas/roadmapResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import RoadmapReleaseCard from "./RoadmapReleaseCard.tsx";

export interface ProjectRoadmapProps {
  roadmap: RoadmapResource;
}

/**
 * The roadmap page (route `projectRoadmap`, `/:projectSlug/roadmap`).
 *
 * ⚠️ **This page may be read by someone with no account.** It is a top-level
 * route rather than a child of `project`, which is what keeps it out of the
 * `$secure()` subtree: everything under `/:projectSlug` is member-gated AND
 * client-rendered, so nothing there ships HTML a crawler can read. Being
 * unguarded is what makes this server-render, and the server render is the
 * whole point of the page. Do not add a guard here, and do not fetch anything
 * in a `useEffect` that the page needs in order to say what it says.
 *
 * The route owns the URL and the shell; who may see it is decided by
 * `projects.roadmapVisibility` in the loader's endpoint, not here.
 *
 * Everything on this page is read-only, and there are **no links out**. Every
 * other Lore surface a release could point at - the release detail, the
 * changelog, an epic - is member-gated, so a link would be an invitation to a
 * login screen.
 */
const ProjectRoadmap = (props: ProjectRoadmapProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { project, releases } = props.roadmap;

  const upcoming = releases.filter((release) => !release.releasedAt);
  const shipped = releases.filter((release) => release.releasedAt);

  return (
    // `min-h-0 flex-1 overflow-y-auto` on the outer element, not padding on an
    // inner one. `Layout` is `h-svh overflow-hidden`, so a page that does not
    // claim the remaining height and scroll inside it simply loses everything
    // past the fold - the same shape `ProjectFeedbackRequest` uses, and for
    // the same reason.
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <p className="text-muted-foreground text-sm">
            {tr("roadmap.subtitle")}
          </p>
        </header>

        {releases.length === 0 ? (
          <p className="text-muted-foreground text-sm">{tr("roadmap.empty")}</p>
        ) : null}

        {upcoming.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {tr("roadmap.section.upcoming")}
            </h2>
            {upcoming.map((release) => (
              <RoadmapReleaseCard
                key={release.tag ?? release.title}
                release={release}
              />
            ))}
          </section>
        ) : null}

        {shipped.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {tr("roadmap.section.shipped")}
            </h2>
            {shipped.map((release) => (
              <RoadmapReleaseCard
                key={release.tag ?? release.title}
                release={release}
              />
            ))}
          </section>
        ) : null}

        {/* The only outbound link on the page, and it points AWAY from the
            project rather than into it: everything inside is member-gated, so
            a link there would be an invitation to a login screen. */}
        <footer className="text-muted-foreground border-border border-t pt-6 text-xs">
          {tr("roadmap.poweredBy")}
        </footer>
      </div>
    </main>
  );
};

export default ProjectRoadmap;
