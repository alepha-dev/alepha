import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import type { DeployController } from "@/api/controllers/DeployController.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AppDeployRunProps {
  run: Record<string, any>;
  projectId: number;
  canWrite: boolean;
  /**
   * Whether anything in the list is still moving. The poll is per list rather
   * than per row, so one live run refreshes them all and a finished list
   * refreshes nothing.
   */
  live: boolean;
  onFollow: () => void;
  onChanged: () => void;
}

/**
 * One run: what shipped, how it went, and its log.
 *
 * ## ⚠️ Two rollback mechanisms, and this must not conflate them
 *
 * **Fast**: point a new deployment at an older Cloudflare `version_id`.
 * Seconds, no artifact fetch, no upload, and it works even under `latest`-only
 * retention because Cloudflare keeps every uploaded version server-side.
 * **Artifact**: re-deploy the stored build, needed when the version is gone or
 * the estate changed.
 *
 * The server decides which is available (`planDeploymentRollback`) and says
 * WHY when the fast one is not, so this renders the plan rather than guessing
 * at it. Offering the fast one when it is unavailable fails after the operator
 * has already confirmed.
 *
 * ## ⚠️ Rollback is code-only
 *
 * The database is not rolled back with it, so a version predating a migration
 * runs old code against a new schema. The confirmation names how many, and the
 * server REQUIRES the acknowledgement rather than merely displaying it - the
 * fast path invites clicking precisely because it is cheap.
 */
const AppDeployRun = (props: AppDeployRunProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const deployApi = useClient<DeployController>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const run = props.run;
  const status = String(run.status ?? "");
  const moving = status === "queued" || status === "running";

  /**
   * ⚠️ The poll, and it stops itself. An interval that outlives the run is the
   * shape of the QuestGraph incident; `live` goes false the moment nothing in
   * the list is moving, and the effect tears the timer down with it.
   */
  useEffect(() => {
    if (!props.live) {
      return;
    }
    const timer = setInterval(() => props.onFollow(), 3_000);
    return () => clearInterval(timer);
  }, [props.live, props.onFollow]);

  const log = (run.log ?? []) as Array<{ at: string; text: string }>;

  /**
   * ⚠️ **Spelled out rather than `tr(`app.deploy.status.${status}`)`.** An
   * interpolated key is invisible to `check:i18n`: it reports all five as
   * unused, and a MISSING one as nothing at all. Written this way each key is a
   * literal the check can see and the compiler can refuse.
   */
  const statusLabel =
    status === "running"
      ? tr("app.deploy.status.running")
      : status === "succeeded"
        ? tr("app.deploy.status.succeeded")
        : status === "failed"
          ? tr("app.deploy.status.failed")
          : status === "cancelled"
            ? tr("app.deploy.status.cancelled")
            : tr("app.deploy.status.queued");

  const rollback = async () => {
    setBusy(true);
    try {
      const plan = (await deployApi.planDeploymentRollback({
        params: { projectId: props.projectId, deploymentId: String(run.id) },
      })) as Record<string, any>;

      const migrations = Number(plan.migrationsSince ?? 0);
      const confirmed = await dialog.confirm({
        title: tr("app.deploy.rollback.title", { args: [String(run.tag)] }),
        description: [
          plan.path === "version"
            ? tr("app.deploy.rollback.fast")
            : (plan.reason ?? tr("app.deploy.rollback.slow")),
          // ⚠️ The warning the dialog exists for. Code goes back; the schema
          // does not.
          migrations > 0
            ? tr("app.deploy.rollback.migrations", {
                args: [String(migrations)],
              })
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: tr("app.deploy.rollback.confirm"),
        destructive: migrations > 0,
      });
      if (!confirmed) {
        return;
      }

      if (plan.path === "version") {
        await deployApi.rollbackDeployment({
          params: { projectId: props.projectId, deploymentId: String(run.id) },
          body: { acknowledgeMigrations: migrations > 0 },
        });
      } else {
        // The fallback, and it is a plain deploy of the same tag: there is no
        // version to point at, so the bytes have to go up again.
        await deployApi.startDeploy({
          params: {
            projectId: props.projectId,
            instanceId: String(run.instanceId),
          },
          body: { tag: String(run.tag) },
        });
      }
      toaster.success(tr("app.deploy.rollback.started"));
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={status === "failed" ? "destructive" : "tint"}>
          {statusLabel}
        </Badge>
        <span className="font-mono text-sm">{String(run.tag)}</span>
        <span
          className="text-muted-foreground font-mono text-xs"
          title={String(run.sha256 ?? "")}
        >
          {String(run.sha256 ?? "").slice(0, 12)}
        </span>
        <TimeAgo
          value={String(run.createdAt)}
          className="text-muted-foreground text-xs"
        />

        <span className="ml-auto flex items-center gap-2">
          {log.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
              {open ? tr("app.deploy.log.hide") : tr("app.deploy.log.show")}
            </Button>
          ) : null}
          {props.canWrite && status === "succeeded" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={rollback}
              data-testid={`app-deploy-rollback-${run.id}`}
            >
              {tr("app.deploy.rollback")}
            </Button>
          ) : null}
        </span>
      </div>

      {run.error ? (
        <p className="text-destructive text-xs">{String(run.error)}</p>
      ) : null}

      {/*
        Open by itself while the run is moving, so a deploy somebody just
        started is readable without a click, and collapsible afterwards so a
        list of twenty finished runs is still a list.
      */}
      {open || moving ? (
        <pre className="bg-muted/50 max-h-64 overflow-auto rounded-md p-2 font-mono text-xs">
          {log.map((line) => line.text).join("\n")}
        </pre>
      ) : null}
    </div>
  );
};

export default AppDeployRun;
