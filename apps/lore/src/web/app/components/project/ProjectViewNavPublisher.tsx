import type { NavGroup } from "@alepha/ui/components/app-shell/app-shell";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect } from "react";

import type { AppRouter } from "../../AppRouter.ts";
import { currentInstancesAtom } from "../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import {
  type ProjectNavEntry,
  projectNavAtom,
} from "../../atoms/projectNavAtom.ts";

export interface ProjectViewNavPublisherProps {
  /**
   * The sidebar as `ProjectView` built it, already gated on this project's
   * capabilities.
   */
  nav: NavGroup[];
}

/**
 * Publishes what the sidebar offers, so the ⌘K palette can list pages and
 * apps beside its content hits. Renders nothing.
 *
 * Its own component because `ProjectView` returns early when the project atom
 * is not filled yet, and this work needs two hooks. Inline, those hooks sat
 * BELOW that return: legal on every render where a project existed, and the
 * "rendered fewer hooks than expected" crash on the first render where one
 * did not. Mounting a child conditionally is the shape React actually
 * supports for "these hooks only apply once we have data".
 *
 * Pages are derived from the built `nav` rather than assembled a second time —
 * see `projectNavAtom`. Flattened here rather than in the palette so the
 * palette never has to know the sidebar's shape: `children` is what makes an
 * entry a group, and a group's own row is a disclosure with no destination of
 * its own, so it contributes its children and not itself.
 *
 * ## ⚠️ Instances are appended from the atom, not read off the sidebar
 *
 * They used to BE sidebar children, so flattening the nav produced them for
 * free. #1771 collapsed that group to one entry, and dropping the children
 * would have dropped every app out of ⌘K in the same commit — leaving the list
 * page as the only door to one.
 *
 * So the two sources are deliberately different. Pages still come from the one
 * computation `projectNavAtom`'s doc insists on, because a second gating pass
 * would drift the first time a feature flag moved. Instances come from
 * `currentInstancesAtom`, which IS the data and cannot disagree with anything.
 *
 * ⚠️ A palette row is an INSTANCE, so both halves render: three copies of one
 * app would otherwise be three identical rows. `matchProjectNav` matches on the
 * label, so typing `b14` finds `club / b14-production`.
 */
const ProjectViewNavPublisher = (props: ProjectViewNavPublisherProps) => {
  const router = useRouter<AppRouter>();
  const [, setProjectNav] = useStore(projectNavAtom);
  const [project] = useStore(currentProjectAtom);
  const [instances] = useStore(currentInstancesAtom);

  const navPages: ProjectNavEntry[] = props.nav.flatMap((group) =>
    group.items.flatMap((item): ProjectNavEntry[] => {
      if (item.children?.length) {
        return item.children
          .filter((child) => !!child.href)
          .map((child) => ({
            // Coercion at a boundary: the value is a form/route/chart primitive whose
            // declared type is wider than what can reach here.
            // oxlint-disable-next-line typescript/no-base-to-string
            label: String(child.label),
            href: String(child.href),
            kind: "app",
          }));
      }
      if (!item.href) return [];
      return [
        // Coercion at a boundary: the value is a form/route/chart primitive whose
        // declared type is wider than what can reach here.
        // oxlint-disable-next-line typescript/no-base-to-string
        { label: String(item.label), href: String(item.href), kind: "page" },
      ];
    }),
  );

  // `?? []` is the could-not-read state: a palette that offered nothing is the
  // honest answer there, and the list page says why.
  const navInstances: ProjectNavEntry[] = project
    ? (instances ?? []).map((instance) => ({
        label: `${instance.app} / ${instance.env}`,
        href: router.path("app", {
          params: {
            projectSlug: project.slug,
            app: instance.app,
            env: instance.env,
          },
        }),
        kind: "app",
      }))
    : [];

  const entries = [...navPages, ...navInstances];

  // Keyed on the CONTENT, not the array: `entries` is rebuilt on every render,
  // so an effect depending on its identity would set the atom, re-render, and
  // loop. Cleared on unmount like the other `current*` atoms — a stale page
  // list would otherwise offer another project's apps.
  const navSignature = JSON.stringify(entries);
  useEffect(() => {
    setProjectNav(entries);
    return () => setProjectNav(undefined);
  }, [navSignature, setProjectNav]);

  return null;
};

export default ProjectViewNavPublisher;
