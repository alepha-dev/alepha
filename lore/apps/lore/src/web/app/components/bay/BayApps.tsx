import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { formatBytes } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";
import BayActions from "./BayActions.tsx";
import {
  type BayInstanceRow,
  bayInstanceRows,
  bayProcessState,
} from "./bayInstanceRow.ts";
import BayStateBadge from "./BayStateBadge.tsx";
import { useBayInventory } from "./useBayInventory.ts";

/**
 * Everything on the machine, and everything Lore expected to find there.
 *
 * ## The reconciliation is the feature
 *
 * The machine reports `(app, env)` and knows nothing about projects. Held
 * against the instances pointing at this estate, three states fall out, and
 * the third is what earns the table: an instance Lore tracks that the machine
 * did not report is a failed deploy or a removed unit, and nothing else in the
 * product notices it.
 *
 * The states arrive as data (#Q1953). Nothing here re-derives a match.
 *
 * ⚠️ **A near-miss reads as a near-miss.** `app_instances` has no parent table
 * and a typo silently creates a second app, so `club` and `clbu` are two apps
 * and nothing complains. Such a pair shows here as "not in Lore" beside
 * "expected here" - which is exactly the shape of a typo.
 *
 * ⚠️ **Two different states live on one row**: what Lore knows about it (the
 * reconciliation) and what the process is doing (`state` plus `stopped`).
 * Neither substitutes for the other.
 *
 * ⚠️ **The machine's `problems[]` are verbatim and untranslated**, labelled as
 * Bay's own report. They are the words `bay status` prints on the box, and an
 * operator comparing the two screens has to see the same sentence. Lore's own
 * badges come from the booleans beside them.
 */
const BayApps = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const { estate, data } = useBayInventory();

  if (!estate) {
    return null;
  }
  const rows = bayInstanceRows(data);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AlephaTable<BayInstanceRow>
        className="min-h-0 flex-1"
        data={rows}
        // The two empty states are different sentences: a machine that runs
        // nothing is not a filter that matched nothing.
        emptyState={{
          title: String(tr("bay.apps.empty")),
          description: String(tr("bay.apps.empty.description")),
        }}
        noMatchState={{
          title: String(tr("bay.apps.noMatch")),
          description: String(tr("bay.apps.noMatch.description")),
        }}
        // Memory descending, resolved in `bayInstanceRows` rather than handed
        // to the table's own sort: the answer has to put unmeasured rows last,
        // which a plain descending sort on an absent field does not.
        columns={{
          app: {
            label: tr("bay.apps.col.app"),
            sortable: true,
            cell: (row) => (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  {row.reported && row.project && row.instanceId ? (
                    // ⚠️ `projectSlug` is passed EXPLICITLY. The router merges
                    // the current route's params by name, and this route holds
                    // `estateId` and nothing else - without it the link
                    // renders a literal `:projectSlug` and goes nowhere.
                    <a
                      className="truncate font-medium underline-offset-4 hover:underline"
                      href={
                        row.project.slug
                          ? router.path("app", {
                              params: {
                                projectSlug: row.project.slug,
                                app: row.app,
                                env: row.env,
                              },
                            })
                          : undefined
                      }
                    >
                      {row.app}
                    </a>
                  ) : (
                    <span className="truncate font-medium">{row.app}</span>
                  )}
                  <span className="text-muted-foreground truncate text-xs">
                    {row.env}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {row.reported && !row.project && (
                    <Badge variant="outline" className="text-xs">
                      {tr("bay.apps.untracked")}
                    </Badge>
                  )}
                  {!row.reported && (
                    <Badge variant="outline" className="text-xs">
                      {tr("bay.apps.missing")}
                    </Badge>
                  )}
                  {row.reported && row.project && (
                    <span className="text-muted-foreground truncate text-xs">
                      {row.project.title}
                    </span>
                  )}
                </span>
              </span>
            ),
          },
          state: {
            label: tr("bay.apps.col.state"),
            // ⚠️ NOT sortable, deliberately. This renders a text enum, and
            // sorting one sorts the label rather than the meaning.
            sortable: false,
            cell: (row) => <BayStateBadge state={bayProcessState(row)} />,
          },
          runtime: {
            label: tr("bay.apps.col.runtime"),
            sortable: true,
            cell: (row) => (
              <span className="text-muted-foreground text-xs">
                {(row.reported && row.runtime) || "-"}
              </span>
            ),
          },
          release: {
            label: tr("bay.apps.col.release"),
            sortable: true,
            cell: (row) => (
              <span className="text-muted-foreground truncate text-xs">
                {(row.reported && row.release) || "-"}
              </span>
            ),
          },
          memoryBytes: {
            label: tr("bay.apps.col.memory"),
            sortable: true,
            cell: (row) => (
              <span className="text-xs tabular-nums">
                {/* Absent, never zero: an unsupervised process measured
                    nothing, and "0 B" would be a reading. */}
                {row.reported && row.memoryBytes !== undefined
                  ? formatBytes(row.memoryBytes)
                  : "-"}
              </span>
            ),
          },
          restarts: {
            label: tr("bay.apps.col.restarts"),
            sortable: true,
            cell: (row) => (
              <span className="text-xs tabular-nums">
                {row.reported && row.restarts !== undefined
                  ? String(row.restarts)
                  : "-"}
              </span>
            ),
          },
          startedAt: {
            label: tr("bay.apps.col.uptime"),
            sortable: true,
            cell: (row) => (
              <span className="text-muted-foreground text-xs">
                {row.reported && row.startedAt
                  ? String(l(row.startedAt, { date: "fromNow" }))
                  : "-"}
              </span>
            ),
          },
          lastRequestAt: {
            label: tr("bay.apps.col.lastRequest"),
            sortable: true,
            cell: (row) => (
              <span className="text-muted-foreground text-xs">
                {row.reported && row.lastRequestAt
                  ? String(l(row.lastRequestAt, { date: "fromNow" }))
                  : row.reported && row.crons
                    ? // A cron changes the meaning of silence: an app that
                      // sends a weekly email answers nobody and is not
                      // abandoned.
                      tr("bay.apps.cronsOnly", { args: [String(row.crons)] })
                    : "-"}
              </span>
            ),
          },
          lastBackupAt: {
            label: tr("bay.apps.col.backup"),
            sortable: true,
            cell: (row) => {
              if (!row.reported || !row.backups) {
                return <span className="text-muted-foreground text-xs">-</span>;
              }
              return (
                <span className="flex items-center gap-1.5 text-xs">
                  {row.lastBackupAt
                    ? String(l(row.lastBackupAt, { date: "fromNow" }))
                    : tr("bay.apps.backupNever")}
                  {row.backupStale && (
                    <Badge variant="outline" className="text-xs">
                      {tr("bay.apps.backupStale")}
                    </Badge>
                  )}
                </span>
              );
            },
          },
          actions: {
            label: tr("bay.apps.col.actions"),
            sortable: false,
            // The same component the instance page uses, so a verb cannot
            // appear in one place and not the other, and the state rules are
            // written once.
            cell: (row) => (
              <span
                // The row opens the instance; the buttons act on it. Without
                // this every click here would also navigate away from the
                // outcome it is about to report.
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                role="presentation"
              >
                <BayActions row={row} />
              </span>
            ),
          },
          problems: {
            label: tr("bay.apps.col.problems"),
            sortable: false,
            cell: (row) =>
              row.reported && row.problems.length > 0 ? (
                <span
                  className="text-muted-foreground flex flex-col gap-0.5 font-mono text-xs"
                  title={String(tr("bay.apps.problems.source"))}
                >
                  {row.problems.map((problem) => (
                    <span key={problem}>{problem}</span>
                  ))}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">-</span>
              ),
          },
        }}
        onRowClick={(row) =>
          void router.push("bayApp", {
            params: { estateId: estate.id, app: row.app, env: row.env },
          })
        }
      />
    </div>
  );
};

export default BayApps;
