import { useQuery } from "alepha/react";
import { Link } from "alepha/react/router";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../core/Card.tsx";

export interface AdminDashboardCountCardProps {
  /**
   * Heading, already localised by the caller.
   */
  label: ReactNode;

  /**
   * Line under the number, saying what was counted.
   */
  description?: ReactNode;

  icon?: ReactNode;

  /**
   * Where the whole tile links. A path rather than a route name: the built-in
   * admin paths are fixed by `AdminRouter`, and a name would drag the router
   * in for no gain.
   */
  href: string;

  /**
   * Resolves the number. A rejection renders a dash rather than an error — a
   * dashboard is glanceable, and one unreachable count must not take the page
   * down with it.
   */
  load: () => Promise<number>;
}

/**
 * The generic "how many of these are there" tile, and the only component the
 * built-in cards use.
 *
 * It exists so the built-in cards can stay plain data in `AdminRouter`, which
 * is where the API clients already live — a component per card would mean a
 * file per card, each one re-deriving the same fetch-and-render.
 */
export const AdminDashboardCountCard = (
  props: AdminDashboardCountCardProps,
) => {
  const query = useQuery(
    {
      // The href identifies the count. `load` is a fresh closure on every
      // render of the parent, so it is not a dependency: the query reads the
      // latest one when it runs, and a re-render does not refetch.
      key: ["admin-dashboard-count", props.href],
      handler: () => props.load(),
      // Quiet on purpose, as `load` says: one unreachable count renders a dash,
      // not a toast. `onError` marks the failure handled, so a mounted
      // `ActionErrorToaster` skips it while error reporting still reads it.
      onError: () => {},
    },
    [props.href],
  );
  const value = query.data;
  const failed = query.error !== undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {props.icon}
          <Link href={props.href}>{props.label}</Link>
        </CardTitle>
        {props.description ? (
          <CardDescription>{props.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">
          {failed ? "—" : value === undefined ? "…" : value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
};
