import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useClient, useInject } from "alepha/react";
import { useRouter } from "alepha/react/router";
import {
  AlertCircle,
  CheckCircle2,
  DatabaseBackup,
  ExternalLink,
  Square,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { BayAppController } from "../../api/controllers/BayAppController.ts";
import type {
  BayApp,
  BayAppUsage,
} from "../../api/services/BayControlService.ts";
import { quietLabel } from "./quietLabel.ts";

export interface AppListProps {
  apps: BayApp[];
}

const AppList = (props: AppListProps) => {
  const bayApi = useClient<BayAppController>();
  const dt = useInject(DateTimeProvider);
  const router = useRouter();
  const dialog = useDialog();

  const stop = useAction<[BayApp]>(
    {
      handler: async (app) => {
        // Stopping takes a site offline. Confirm through the imperative dialog
        // API — `window.confirm` is banned in this codebase.
        const confirmed = await dialog.confirm({
          title: `Stop ${app.name}/${app.env}?`,
          description: `${app.domain} will stop answering until it is deployed again.`,
          confirmLabel: "Stop",
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        await bayApi.stopApp({ params: { name: app.name, env: app.env } });
        await router.reload();
      },
    },
    [],
  );

  /**
   * Unregisters an app, keeping its data.
   *
   * The non-purging form on purpose — the same default as `bay remove`. Erasing
   * a database is not something to offer behind a row button; someone who
   * really means it can run `bay remove --purge`, where the warning is printed
   * and the intent is explicit.
   */
  const remove = useAction<[BayApp]>(
    {
      handler: async (app) => {
        const confirmed = await dialog.confirm({
          title: `Remove ${app.name}/${app.env}?`,
          description: `${app.domain} stops being served. Its database and uploads are KEPT — redeploying the same name brings it back.`,
          confirmLabel: "Remove",
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        await bayApi.removeApp({ params: { name: app.name, env: app.env } });
        await router.reload();
      },
    },
    [],
  );

  /**
   * The one action here with nothing visible to show for itself.
   *
   * Stopping an app changes the list; a backup leaves the page identical
   * whether it uploaded or failed on missing S3 credentials. Without this,
   * clicking Backup and clicking Backup-on-a-Bay-with-no-bucket look the same,
   * and someone walks away believing they have a snapshot.
   */
  const [backedUp, setBackedUp] = useState<string | undefined>();

  const backup = useAction<[BayApp]>(
    {
      handler: async (app) => {
        setBackedUp(undefined);
        await bayApi.backupApp({ params: { name: app.name, env: app.env } });
        setBackedUp(`${app.name}/${app.env}`);
      },
    },
    [],
  );

  if (!props.apps.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No apps yet</CardTitle>
          <CardDescription>
            Deploy an artifact above and it will appear here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apps</CardTitle>
        <CardDescription>{props.apps.length} deployed</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(backup.error || stop.error || remove.error) && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              {(backup.error ?? stop.error ?? remove.error)?.message}
            </AlertDescription>
          </Alert>
        )}
        {backedUp && !backup.error && (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>Backed up {backedUp}.</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col divide-y">
          {props.apps.map((app) => (
            <div
              key={`${app.name}/${app.env}`}
              className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  {/*
                    The name is the way in. An app row that shows a status but
                    cannot be opened makes the reader hunt for where the detail
                    lives.
                  */}
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() =>
                      void router.push("appUsage", {
                        params: { slug: app.name },
                      })
                    }
                  >
                    {app.name}
                  </button>
                  <Badge variant="secondary">{app.env}</Badge>
                  {/*
                    Only the bad case is called out. A running app is the norm
                    and needs no decoration; a stopped one is the thing someone
                    scanning this list has to notice.
                  */}
                  {app.running === false && (
                    <Badge variant="destructive">Stopped</Badge>
                  )}
                  {/*
                    Restarts, and only restarts, get a badge. `running` cannot
                    tell an app that is up from an app that keeps coming back
                    up — between two crashes a loop reports as perfectly
                    healthy, which is how one goes unnoticed for a week.
                  */}
                  {(app.usage?.restarts ?? 0) > 0 && (
                    <Badge variant="destructive">
                      {app.usage?.restarts}× restarted
                    </Badge>
                  )}
                  {/*
                    The deletion-triage badge, and the only one here that is not
                    about health. With twenty prototypes on one host the question
                    stops being "is this broken" and becomes "is anyone still
                    using this".

                    Not destructive: quiet is not a fault. An app can be quiet
                    for a year and be exactly what someone wants next month —
                    this is an invitation to ask, not a defect to fix.
                  */}
                  {quietLabel(app, dt) && (
                    <Badge variant="outline">{quietLabel(app, dt)}</Badge>
                  )}
                </div>
                <a
                  href={`https://${app.domain}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm text-muted-foreground hover:underline"
                >
                  {app.domain}
                  <ExternalLink className="ml-1 inline size-3" />
                </a>
              </div>
              <div className="flex flex-col items-end text-sm text-muted-foreground">
                <span>{app.release}</span>
                {app.usage && (
                  <span className="text-xs tabular-nums">
                    {formatUsage(app.usage, dt)}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={backup.loading}
                onClick={() => backup.run(app)}
              >
                <DatabaseBackup />
                Backup
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={stop.loading}
                onClick={() => stop.run(app)}
              >
                <Square />
                Stop
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={remove.loading}
                onClick={() => remove.run(app)}
              >
                <Trash2 />
                Remove
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Renders a supervisor reading as one scannable line.
 *
 * Every field is optional because Bay reports nothing rather than zero when it
 * does not know — a zero would read as a measured fact. So each piece is
 * emitted only if present, and an entirely empty reading renders nothing at
 * all instead of an em-dash that suggests a broken app.
 */
const formatUsage = (usage: BayAppUsage, dt: DateTimeProvider): string => {
  const parts: string[] = [];
  if (usage.memoryBytes) {
    parts.push(`${(usage.memoryBytes / 1024 / 1024).toFixed(0)} MB`);
  }
  if (usage.startedAt) {
    // `fromNow()` rather than a hand-rolled subtraction: it goes through
    // DateTimeProvider, so the clock stays substitutable in tests, and it
    // reads the same as every other relative time in the codebase.
    parts.push(`up ${dt.of(usage.startedAt).fromNow(true)}`);
  }
  return parts.join(" · ");
};

export default AppList;
