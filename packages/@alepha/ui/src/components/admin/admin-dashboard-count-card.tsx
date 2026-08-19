import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Link } from "alepha/react/router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

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
  const [value, setValue] = useState<number | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    props
      .load()
      .then((n) => {
        if (alive) setValue(n);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // `load` is a fresh closure on every render of the parent, so depending on
    // it would refetch forever. The href identifies the count instead.
  }, [props.href]);

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
