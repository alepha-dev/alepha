import { Badge } from "@alepha/ui/components/ui/badge";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { formatBytes } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";
import BayActions from "./BayActions.tsx";
import { bayInstanceRows, bayProcessState } from "./bayInstanceRow.ts";
import BayLogTail from "./BayLogTail.tsx";
import BayStateBadge from "./BayStateBadge.tsx";
import { useBayInventory } from "./useBayInventory.ts";

/**
 * One instance on the machine, in full.
 *
 * ⚠️ **It renders for a Lore-only instance too**, and says so rather than
 * 404ing. That row is in the Apps table by design - it is what a failed deploy
 * looks like - and clicking it must lead somewhere that explains itself.
 *
 * ⚠️ **A cron count changes the meaning of silence.** `bay status` appends
 * "(N cron(s) declared)" to its traffic line because an app serving a weekly
 * email answers no requests and is not abandoned. A page that says "idle for 6
 * days" without it is actively misleading.
 *
 * ⚠️ **"Never answered a request" is spelled out**, not left blank, for the
 * reason `bay status` spells it out: an app nobody has ever reached is the
 * single most likely thing on a shared host to be safe to delete, and that is
 * the sentence somebody wants in front of them before they do it.
 *
 * ⚠️ **"Declares no database" is a different fact from "never backed up"**,
 * and they get different sentences. Reporting the first as the second is how a
 * permanent, wrong warning gets ignored.
 *
 * The data is the same payload the table reads, filtered to this pair: a host
 * has tens of instances, so a per-instance endpoint would be a second query
 * for nothing.
 */
const BayInstance = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const { estate, data } = useBayInventory();

  const app = String(routerState.params?.app ?? "");
  const env = String(routerState.params?.env ?? "");
  const row = bayInstanceRows(data).find(
    (candidate) => candidate.app === app && candidate.env === env,
  );

  if (!estate) {
    return null;
  }

  if (!row) {
    return (
      <div className="flex flex-col gap-2 py-8">
        <h2 className="text-lg font-semibold">{`${app}/${env}`}</h2>
        <p className="text-muted-foreground text-sm">
          {tr("bay.instance.unknown")}
        </p>
      </div>
    );
  }

  const state = bayProcessState(row);
  const reported = row.reported ? row : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{`${app}/${env}`}</h2>
            <BayStateBadge state={state} />
            {row.project?.slug && (
              // ⚠️ `projectSlug` explicitly: this route holds `estateId`, and
              // the router merges the current params by name.
              <a
                className="text-sm underline-offset-4 hover:underline"
                href={router.path("app", {
                  params: {
                    projectSlug: row.project.slug,
                    app: row.app,
                    env: row.env,
                  },
                })}
              >
                {tr("bay.instance.openInProject", {
                  args: [row.project.title],
                })}
              </a>
            )}
          </div>

          {!reported && (
            <p className="text-muted-foreground text-sm">
              {tr("bay.instance.expected")}
            </p>
          )}

          <BayActions row={row} />

          {reported && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <Fact
                  label={String(tr("bay.instance.memory"))}
                  value={
                    reported.memoryBytes === undefined
                      ? undefined
                      : formatBytes(reported.memoryBytes)
                  }
                />
                <Fact
                  label={String(tr("bay.instance.cpuSeconds"))}
                  value={
                    reported.cpuSeconds === undefined
                      ? undefined
                      : `${Math.round(reported.cpuSeconds)}s`
                  }
                />
                <Fact
                  label={String(tr("bay.instance.tasks"))}
                  value={
                    reported.tasks === undefined
                      ? undefined
                      : String(reported.tasks)
                  }
                />
                <Fact
                  label={String(tr("bay.instance.restarts"))}
                  value={
                    reported.restarts === undefined
                      ? undefined
                      : String(reported.restarts)
                  }
                />
                <Fact
                  label={String(tr("bay.instance.started"))}
                  value={
                    reported.startedAt
                      ? String(l(reported.startedAt, { date: "fromNow" }))
                      : undefined
                  }
                />
                <Fact
                  label={String(tr("bay.instance.release"))}
                  value={reported.release}
                />
                <Fact
                  label={String(tr("bay.instance.runtime"))}
                  value={reported.runtime}
                />
                <Fact
                  label={String(tr("bay.instance.port"))}
                  value={
                    reported.port === undefined
                      ? undefined
                      : String(reported.port)
                  }
                />
              </dl>

              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {tr("bay.instance.domains")}
                </span>
                {reported.domains?.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {/* Canonical first, as the machine stores them. */}
                    {reported.domains.map((domain) => (
                      <Badge key={domain} variant="outline">
                        {domain}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {tr("bay.instance.noDomains")}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {reported && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">
              {tr("bay.instance.traffic")}
            </h3>
            <p className="text-sm">
              {reported.lastRequestAt
                ? tr("bay.instance.lastRequest", {
                    args: [
                      String(l(reported.lastRequestAt, { date: "fromNow" })),
                    ],
                  })
                : tr("bay.instance.neverAnswered")}
              {reported.crons
                ? ` ${tr("bay.instance.crons", { args: [String(reported.crons)] })}`
                : ""}
            </p>

            <h3 className="mt-2 text-sm font-semibold">
              {tr("bay.instance.backups")}
            </h3>
            <p className="text-sm">
              {!reported.backups
                ? // A different fact from "never backed up": there is nothing
                  // here Bay could snapshot.
                  tr("bay.instance.noDatabase")
                : reported.lastBackupAt
                  ? tr("bay.instance.lastBackup", {
                      args: [
                        String(l(reported.lastBackupAt, { date: "fromNow" })),
                      ],
                    })
                  : tr("bay.instance.neverBackedUp")}
              {reported.backupStale ? ` ${tr("bay.instance.backupStale")}` : ""}
            </p>
            {reported.lastBackupError && (
              <p className="text-muted-foreground font-mono text-xs">
                {reported.lastBackupError}
              </p>
            )}

            {reported.problems.length > 0 && (
              <>
                <h3 className="mt-2 text-sm font-semibold">
                  {tr("bay.instance.problems")}
                </h3>
                {/* The machine's own words, untranslated, so this screen and
                    `bay status` on the box read the same. */}
                <ul className="text-muted-foreground flex flex-col gap-1 font-mono text-xs">
                  {reported.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <BayLogTail app={app} env={env} />
    </div>
  );
};

export default BayInstance;

interface FactProps {
  label: string;
  /** Absent means the supervisor knew nothing, which is not zero. */
  value?: string;
}

const Fact = (props: FactProps) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-muted-foreground text-xs">{props.label}</dt>
    <dd
      className={
        props.value ? "font-medium tabular-nums" : "text-muted-foreground"
      }
    >
      {props.value ?? "-"}
    </dd>
  </div>
);
