import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { DeployController } from "../../../../../api/controllers/DeployController.ts";

export interface AppDeployRollbackDialogProps {
  /**
   * The run to roll back to, or undefined when the dialog is closed.
   */
  run?: Record<string, any>;
  /**
   * The run live on this copy now, named in the explanation.
   */
  current?: Record<string, any>;
  projectId: number;
  onClose: () => void;
}

/**
 * What rolling back to one run would do, and the button that does it.
 *
 * ## The plan is read before anything is offered
 *
 * The server decides the path (`planDeploymentRollback`): **fast**, pointing a
 * new Cloudflare deployment at the version that run uploaded, or **artifact**,
 * redeploying the stored build when the version is gone or the host keeps
 * none. It says why when the fast one is unavailable, so this renders the
 * plan rather than guessing at it, and the confirm button stays disabled until
 * the plan has answered. A plan the server refuses is shown, and nothing can
 * be confirmed.
 *
 * ## ⚠️ Rollback is code-only
 *
 * The database is not rolled back with it, so a version predating a migration
 * runs old code against a new schema. The dialog names how many, and the
 * server REQUIRES the acknowledgement rather than merely displaying it - the
 * fast path invites clicking precisely because it is cheap.
 */
const AppDeployRollbackDialog = (props: AppDeployRollbackDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const deployApi = useClient<DeployController>();
  const run = props.run;
  const runId = run ? String(run.id) : "";

  const plan = useQuery(
    {
      key: ["app-deployment-rollback-plan", props.projectId, runId],
      enabled: !!run,
      handler: async () =>
        (await deployApi.planDeploymentRollback({
          params: { projectId: props.projectId, deploymentId: runId },
        })) as Record<string, any>,
      // Handled: the refusal is shown inside the dialog, where the operator is
      // looking, instead of in a toast behind it.
      onError: () => {},
    },
    [props.projectId, runId],
  );

  const migrations = Number(plan.data?.migrationsSince ?? 0);
  // The schema check (#Q3542) answers the question the count can only raise:
  // whether that build runs on the live schema. Without it, the count is all
  // there is.
  const schema = plan.data?.schema as
    | { verdict: string; changes: Array<{ change: string }> }
    | undefined;
  const listed = schema?.changes.map((it) => it.change).join(", ") ?? "";
  const risk = schema
    ? schema.verdict === "safe"
      ? migrations > 0
        ? tr("app.deploy.rollback.schemaSafe")
        : ""
      : tr(
          schema.verdict === "breaks"
            ? "app.deploy.rollback.schemaBreaks"
            : "app.deploy.rollback.schemaRisky",
          { args: [listed] },
        )
    : migrations > 0
      ? tr("app.deploy.rollback.migrations", { args: [String(migrations)] })
      : "";
  // What the server requires acknowledged: its own warning, or a migration
  // count it could not check against a schema.
  const acknowledge =
    Boolean(plan.data?.warning) || (!schema && migrations > 0);

  // A refusal at either step is the server's sentence, shown by the root
  // `ActionErrorToaster` (#E59, #Q2329).
  const rollback = useAction<[], void>(
    {
      handler: async () => {
        if (!run || !plan.data) return;
        if (plan.data.path === "version") {
          await deployApi.rollbackDeployment({
            params: { projectId: props.projectId, deploymentId: runId },
            body: { acknowledgeMigrations: acknowledge },
          });
        } else {
          // The fallback, and it is a plain deploy of the same tag: there is
          // no version to point at, so the bytes have to go up again.
          await deployApi.startDeploy({
            params: {
              projectId: props.projectId,
              instanceId: String(run.instanceId),
            },
            body: { tag: String(run.tag) },
          });
        }
        toaster.success(tr("app.deploy.rollback.started"));
        props.onClose();
      },
      // The new run joins the history.
      invalidates: [["app-deployments", props.projectId]],
    },
    [deployApi, props.projectId, runId, plan.data, acknowledge, toaster, tr],
  );

  const refused =
    plan.error instanceof Error ? plan.error.message : plan.error ? "" : null;

  return (
    <Dialog
      open={!!run}
      onOpenChange={(open) => {
        if (!open && !rollback.loading) props.onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        data-testid="app-deploy-rollback-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {tr("app.deploy.rollback.title", { args: [String(run?.tag)] })}
          </DialogTitle>
          <DialogDescription>
            {props.current
              ? tr("app.deploy.rollback.what", {
                  args: [
                    String(run?.tag),
                    String(run?.sha256 ?? "").slice(0, 12),
                    String(props.current.tag),
                  ],
                })
              : tr("app.deploy.rollback.whatNoCurrent", {
                  args: [
                    String(run?.tag),
                    String(run?.sha256 ?? "").slice(0, 12),
                  ],
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          {plan.loading && !plan.data ? (
            <p className="text-muted-foreground">
              {tr("app.deploy.rollback.planning")}
            </p>
          ) : refused !== null ? (
            <Alert variant="destructive">
              <AlertDescription>
                {refused || tr("app.deploy.rollback.unavailable")}
              </AlertDescription>
            </Alert>
          ) : plan.data ? (
            <>
              <p>
                {plan.data.path === "version"
                  ? tr("app.deploy.rollback.fast")
                  : (plan.data.reason ?? tr("app.deploy.rollback.slow"))}
              </p>
              <p className="text-muted-foreground">
                {tr("app.deploy.rollback.code")}
              </p>
              {/*
                ⚠️ The warning the dialog exists for. Code goes back; the
                schema does not.
              */}
              {risk ? (
                <Alert className={acknowledge ? "border-amber-500/50" : ""}>
                  <AlertDescription>{risk}</AlertDescription>
                </Alert>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outlined"
            disabled={rollback.loading}
            onClick={() => props.onClose()}
          >
            {tr("common.cancel")}
          </Button>
          <Button
            intent={acknowledge ? "danger" : undefined}
            disabled={!plan.data || rollback.loading}
            loading={rollback.loading}
            onClick={() => void rollback.run()}
            data-testid="app-deploy-rollback-confirm"
          >
            {tr("app.deploy.rollback.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AppDeployRollbackDialog;
