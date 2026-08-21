import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { z } from "alepha";
import { CircleDot, RotateCcw, Search, Trash } from "lucide-react";
import { useState } from "react";

interface Release {
  id: number;
  name: string;
  status: "shipped" | "staged" | "rolled-back";
  firstName: string;
  lastName: string;
  tags: string[];
  durationSeconds: number;
}

const RELEASES: Release[] = [
  ["Aurora", "shipped", "Ada", "Lovelace", ["api"], 94],
  ["Basilisk", "staged", "Grace", "Hopper", ["api", "web"], 231],
  ["Cinder", "shipped", "Alan", "Turing", ["web"], 47],
  ["Dovetail", "rolled-back", "Barbara", "Liskov", ["infra"], 612],
  ["Ember", "shipped", "Ada", "Lovelace", ["infra", "api"], 158],
  ["Foxglove", "staged", "Karen", "Sparck Jones", [], 12],
  ["Gossamer", "shipped", "Alan", "Turing", ["web"], 305],
  ["Halcyon", "shipped", "Grace", "Hopper", ["api"], 76],
  ["Iolite", "rolled-back", "Barbara", "Liskov", ["web", "infra"], 488],
  ["Juniper", "staged", "Karen", "Sparck Jones", ["api"], 143],
  ["Kestrel", "shipped", "Ada", "Lovelace", [], 29],
  ["Lantern", "shipped", "Alan", "Turing", ["infra"], 201],
].map(
  ([name, status, firstName, lastName, tags, durationSeconds], index) =>
    ({
      id: index + 1,
      name,
      status,
      firstName,
      lastName,
      tags,
      durationSeconds,
    }) as Release,
);

const STATUS_TONE: Record<Release["status"], "success" | "warning" | "danger"> =
  {
    shipped: "success",
    staged: "warning",
    "rolled-back": "danger",
  };

const filtersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["shipped", "staged", "rolled-back"]).optional(),
});

const formatDuration = (seconds: number): string =>
  seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

/**
 * AlephaTable's static-data mode — `data` instead of `fetch`.
 *
 * What this page is here to show is the part a `fetch`-shaped wrapper around
 * an array cannot do: the table tracks the array it is given. Remove a row
 * and the count above the table, the table itself, and the pager all move
 * together, because they are all reading the same `useState` and nothing
 * refetches.
 */
const Tables = () => {
  const [releases, setReleases] = useState<Release[]>(RELEASES);

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Table (static data)</h1>
        <p className="text-muted-foreground text-sm">
          <code className="bg-muted rounded px-1 py-0.5">data</code> instead of{" "}
          <code className="bg-muted rounded px-1 py-0.5">fetch</code>: filter,
          sort and paging run in memory over an array the page owns.
        </p>
      </header>

      <Card className="py-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2 p-4">
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
            Owned by the page - {releases.length} of {RELEASES.length} rows
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReleases(RELEASES)}
            disabled={releases.length === RELEASES.length}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <AlephaTable<Release>
            data={releases}
            defaultSize={5}
            // `search` spans two fields and `status` is exact, so the default
            // field matching cannot express it. Filter values arrive already
            // stripped of the empty ones.
            filter={(release, values) => {
              if (values.status && release.status !== values.status) {
                return false;
              }
              if (values.search) {
                const needle = String(values.search).toLowerCase();
                const haystack =
                  `${release.name} ${release.firstName} ${release.lastName}`.toLowerCase();
                if (!haystack.includes(needle)) return false;
              }
              return true;
            }}
            filters={{
              schema: filtersSchema,
              render: (form) => (
                <>
                  <div className="w-44">
                    <Control
                      input={form.input.search}
                      label=""
                      icon={Search}
                      placeholder="Name or owner"
                      inputProps={{ "aria-label": "Search" }}
                    />
                  </div>
                  <div className="w-44">
                    <Control
                      input={form.input.status}
                      label=""
                      clearable
                      icon={CircleDot}
                      clearLabel="All statuses"
                      triggerClassName="w-full"
                      items={[
                        { label: "Shipped", value: "shipped" },
                        { label: "Staged", value: "staged" },
                        { label: "Rolled back", value: "rolled-back" },
                      ]}
                      inputProps={{ "aria-label": "Status" }}
                    />
                  </div>
                </>
              ),
            }}
            columns={{
              name: {
                label: "Release",
                sortable: true,
                className: "font-medium",
                cell: (release) => release.name,
              },
              owner: {
                label: "Owner",
                sortable: true,
                // The cell reads two fields and the column sorts on neither
                // of them as written, which is exactly what `sortValue` is
                // for. Sorting by surname, not by the rendered string.
                sortValue: (release) => release.lastName,
                cell: (release) => (
                  <span className="text-sm">
                    {release.firstName} {release.lastName}
                  </span>
                ),
              },
              status: {
                label: "Status",
                sortable: true,
                cell: (release) => (
                  <Badge variant="tint" tone={STATUS_TONE[release.status]}>
                    {release.status}
                  </Badge>
                ),
              },
              tags: {
                label: "Tags",
                cell: (release) =>
                  release.tags.length ? (
                    <span className="text-muted-foreground text-xs">
                      {release.tags.join(", ")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  ),
              },
              durationSeconds: {
                label: "Duration",
                sortable: true,
                align: "right",
                // Sorts numerically off the raw property even though the cell
                // renders "3m 51s" — a string comparison would put 10m before
                // 2m.
                cell: (release) => (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatDuration(release.durationSeconds)}
                  </span>
                ),
              },
            }}
            rowActions={(release) => [
              {
                icon: Trash,
                label: "Remove",
                destructive: true,
                // No `ctx.refresh()`: the rows are the page's state, so
                // writing to it IS the refresh. The table re-renders from the
                // new array on the same tick.
                onClick: () =>
                  setReleases((prev) =>
                    prev.filter((r) => r.id !== release.id),
                  ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="p-4">
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
            Minimal - no toolbar, no filters, no paging
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AlephaTable<Release>
            data={RELEASES.slice(0, 3)}
            hideColumnPicker
            hideActionsMenu
            pageSizes={[]}
            defaultSize={100}
            columns={{
              name: { label: "Release", cell: (release) => release.name },
              status: { label: "Status", cell: (release) => release.status },
            }}
          />
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="p-4">
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
            Empty
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AlephaTable<Release>
            data={[]}
            hideColumnPicker
            hideActionsMenu
            pageSizes={[]}
            emptyMessage="No releases yet"
            columns={{
              name: { label: "Release", cell: (release) => release.name },
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default Tables;
