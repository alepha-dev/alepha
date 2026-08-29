import type { NavGroup } from "@alepha/ui/components/app-shell/app-shell";
import { useStore } from "alepha/react";
import { useEffect } from "react";

import {
  type ProjectNavEntry,
  projectNavAtom,
} from "../../atoms/projectNavAtom.ts";

export interface ProjectViewNavPublisherProps {
  /**
   * The sidebar as `ProjectView` built it, already gated on this project's
   * features.
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
 * Derived from the built `nav` rather than assembled a second time — see
 * `projectNavAtom`. Flattened here rather than in the palette so the palette
 * never has to know the sidebar's shape: `children` is what makes an entry a
 * group (today only Apps), and a group's own row is a disclosure with no
 * destination of its own, so it contributes its children and not itself.
 */
const ProjectViewNavPublisher = (props: ProjectViewNavPublisherProps) => {
  const [, setProjectNav] = useStore(projectNavAtom);

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

  // Keyed on the CONTENT, not the array: `navPages` is rebuilt on every render,
  // so an effect depending on its identity would set the atom, re-render, and
  // loop. Cleared on unmount like the other `current*` atoms — a stale page
  // list would otherwise offer another project's apps.
  const navSignature = JSON.stringify(navPages);
  useEffect(() => {
    setProjectNav(navPages);
    return () => setProjectNav(undefined);
  }, [navSignature, setProjectNav]);

  return null;
};

export default ProjectViewNavPublisher;
