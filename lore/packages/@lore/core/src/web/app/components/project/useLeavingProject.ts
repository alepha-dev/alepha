import { useEvents } from "alepha/react";
import { useState } from "react";

/**
 * The root segment a navigation is on its way to, when it leaves the project
 * on screen, `slug`: another project's slug, mostly, from the rail or the
 * switcher. `undefined` while no such navigation runs.
 *
 * The shell needs to know because the project layout's loader writes the
 * target project's atoms (`currentProjectAtom` and every module's) as soon as
 * the target's own reads answer, while the router is still loading the page
 * under it. Until that page is ready the old one stays mounted, so without
 * this the old page re-rendered over the NEW project's data: on a switch from
 * `/a/quests` to `/b`, project B's rail icon, sidebar and quest list with
 * "Quests" still highlighted, then B's dashboard a beat later.
 *
 * `slug` is the committed route's param, never `currentProjectAtom`'s, which
 * already names the target halfway through. Read off `state.url` at the
 * transition's start, since its params are only decoded after it: the first
 * path segment is the project slug, `/:projectSlug` being a root-level param.
 * A reserved root (`/new-project`) counts as leaving too, which only shows the
 * skeleton for the moment the next page takes. Home, `/`, has no segment and
 * does not: the project layout leaves with the page.
 */
export const useLeavingProject = (
  slug: string | undefined,
): string | undefined => {
  const [leaving, setLeaving] = useState<string>();

  useEvents(
    {
      "react:transition:begin": ({ state }) => {
        const target = state.url?.pathname.split("/").find(Boolean);
        setLeaving(slug && target !== slug ? target : undefined);
      },
      "react:transition:end": () => {
        setLeaving(undefined);
      },
    },
    [slug],
  );

  return leaving;
};
