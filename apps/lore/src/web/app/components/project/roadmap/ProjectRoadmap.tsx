import { useI18n } from "alepha/react/i18n";

import type { RoadmapResource } from "@/api/schemas/roadmapResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import RoadmapReleaseCard from "./RoadmapReleaseCard.tsx";
import RoadmapShippedRow from "./RoadmapShippedRow.tsx";

export interface ProjectRoadmapProps {
  roadmap: RoadmapResource;
  /**
   * Whether the viewer belongs to this project, from the member endpoint.
   * `false` for everyone else, including a signed-in stranger reading a
   * public roadmap. It gates the links only; the content is identical.
   */
  member: boolean;
}

/**
 * The roadmap page (route `projectRoadmap`, `/:projectSlug/roadmap`), and the
 * one surface in Lore that serves three audiences from one component: a
 * member, a signed-in stranger, and someone with no account at all.
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
 * ## What it deliberately is not
 *
 * Not the releases list with a different stylesheet. That list is a work
 * surface with edit controls and a row per release whatever its state; this
 * is a read surface whose job is to be legible to someone who does not use
 * Lore daily, so open releases get the room and shipped ones collapse to one
 * line each.
 *
 * ## What it must never show
 *
 * Quest-level detail. A stakeholder wants features, not the backlog. Loose
 * quests are counted in the progress bar and are otherwise invisible, and the
 * response schema does not carry a quest title at all, so this is a property
 * of the endpoint rather than a rule the component has to remember. If
 * per-quest detail is ever wanted it is a separate toggle, never the default.
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12">
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
            {/* One column per open release, in the order the server sent
                them, which is `number` ascending. `items-start` so a short
                release does not stretch to the height of a long one - these
                are independent statements, not rows of a table. */}
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {upcoming.map((release) => (
                <RoadmapReleaseCard
                  key={release.tag ?? release.title}
                  release={release}
                  member={props.member}
                />
              ))}
            </div>
          </section>
        ) : null}

        {shipped.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {tr("roadmap.section.shipped")}
            </h2>
            {/* Collapsed to a line each, on purpose. A shipped release is
                settled: the question it answers is "when", and its detail is
                its frozen changelog rather than a progress bar. */}
            <div className="border-border divide-border divide-y rounded-xl border">
              {shipped.map((release) => (
                <RoadmapShippedRow
                  key={release.tag ?? release.title}
                  release={release}
                  member={props.member}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* The only text pointing outside the project. Everything INSIDE it is
            member-gated, which is why a link there is offered to members
            alone. */}
        <footer className="text-muted-foreground border-border border-t pt-6 text-xs">
          {tr("roadmap.poweredBy")}
        </footer>
      </div>
    </main>
  );
};

export default ProjectRoadmap;
