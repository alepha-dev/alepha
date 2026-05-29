import {
  AppShell,
  type AppShellProps,
} from "@alepha/ui/components/app-shell/app-shell";
import { useNavBreadcrumbs } from "./use-nav-breadcrumbs.ts";
import { useNavTree } from "./use-nav-tree.ts";

export interface NavShellProps
  extends Omit<AppShellProps, "nav" | "breadcrumbs"> {
  /**
   * Route name that anchors this shell — typically the layout `$page` mounted
   * at the shell's base path (e.g. `/admin`). The sidebar and breadcrumbs are
   * derived from this page's subtree, so an app can host several shells (a `/`
   * app shell and a `/admin` shell), each scoped to its own routes.
   */
  root: string;
}

/**
 * Data-driven {@link AppShell}: the sidebar nav and breadcrumb trail are
 * derived from the route tree under `root` (via each `$page`'s `nav`
 * metadata), instead of hand-maintained lists. Everything else — brand,
 * top-bar actions, layout variant, fill — passes straight through to
 * `AppShell`.
 */
export const NavShell = (props: NavShellProps) => {
  const { root, ...appShellProps } = props;
  const nav = useNavTree({ root });
  const breadcrumbs = useNavBreadcrumbs({ root });
  return <AppShell {...appShellProps} nav={nav} breadcrumbs={breadcrumbs} />;
};
