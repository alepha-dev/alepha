import {
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  TimeAgo,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { ExternalLink, Play, RotateCcw, Square } from "lucide-react";
import { useState } from "react";

import type { WorkflowController } from "../../../../../api/controllers/WorkflowController.ts";
import type { WorkflowRun } from "../../../../../api/schemas/workflowRunSchema.ts";
import type { Workflow } from "../../../../../api/schemas/workflowSchema.ts";
import WorkflowRunDialog from "./WorkflowRunDialog.tsx";

/**
 * Ship > Workflows (#Q4366, epic #E177): the connected repository's
 * workflows that can be started from Lore, each with Run (a form built
 * from its inputs), and the recent runs with their outcome, who started
 * them from Lore, and Re-run, Re-run failed jobs or Cancel.
 *
 * Read from GitHub on open. While a run shown is queued or in progress,
 * the list refreshes every 15 s, paused on a hidden tab, and stops once
 * every run shown has finished.
 */
const ProjectWorkflows = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<WorkflowController>();
  const [running, setRunning] = useState<Workflow | undefined>();
  const [live, setLive] = useState(false);
  const projectId = project?.id;
  const canRun = can("deploy:workflow");

  const read = useQuery(
    {
      key: ["workflows", projectId],
      handler: async () => {
        const it = await api.getWorkflows({
          params: { projectId: projectId! },
        });
        setLive(it.runs.some(ProjectWorkflows.moving));
        return it;
      },
      enabled: projectId !== undefined,
      runEvery: live ? 15_000 : undefined,
      // The page says what GitHub or the App answered, in place.
      onError: () => {},
    },
    // `runEvery` is read on each render, so `live` stays out of the deps.
    [api, projectId],
  );

  const act = useAction<
    [run: WorkflowRun, what: "rerun" | "failed" | "cancel"],
    boolean
  >(
    {
      handler: async (_context, run, what) => {
        if (what === "cancel") {
          await api.cancelWorkflowRun({
            params: { projectId: projectId!, runId: run.id },
          });
        } else {
          await api.rerunWorkflowRun({
            params: { projectId: projectId!, runId: run.id },
            body: { failedOnly: what === "failed" },
          });
        }
        setLive(true);
        return true;
      },
      invalidates: [["workflows", projectId]],
    },
    [api, projectId],
  );

  if (!project) return null;
  const data = read.data;

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4"
      data-testid="project-workflows"
    >
      {read.error && !data ? (
        <Card data-testid="workflows-error">
          <CardContent className="text-danger-text text-sm">
            {read.error.message}
          </CardContent>
        </Card>
      ) : null}
      {data && !data.connected ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2 text-sm">
            <span>{tr("workflows.notConnected")}</span>
            <Link
              className={textLinkUnderlineClassName}
              href={`/${project.slug}/settings`}
            >
              {tr("workflows.connect")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {data?.connected ? (
        <>
          <Card data-testid="workflows-list">
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{tr("workflows.title")}</span>
                <span className="text-muted-foreground text-xs">
                  {data.repository}
                </span>
              </div>
              {data.workflows.length === 0 ? (
                <span className="text-muted-foreground">
                  {tr("workflows.none")}
                </span>
              ) : (
                <ul className="flex flex-col divide-y">
                  {data.workflows.map((workflow) => (
                    <li
                      key={workflow.id}
                      className="flex items-center justify-between gap-4 py-2"
                      data-testid={`workflow-${workflow.id}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{workflow.name}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {workflow.inputs.length
                            ? workflow.inputs.map((it) => it.name).join(", ")
                            : workflow.path}
                        </span>
                      </span>
                      {canRun && (
                        <Button
                          size="sm"
                          variant="outlined"
                          onClick={() => setRunning(workflow)}
                          data-testid={`workflow-run-${workflow.id}`}
                        >
                          <Play className="size-3.5" />
                          {tr("workflows.run")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card data-testid="workflow-runs">
            <CardContent className="flex flex-col gap-3 text-sm">
              <span className="font-medium">{tr("workflows.runs")}</span>
              {data.runs.length === 0 ? (
                <span className="text-muted-foreground">
                  {tr("workflows.runs.none")}
                </span>
              ) : (
                <ul className="flex flex-col divide-y">
                  {data.runs.map((run) => (
                    <li
                      key={run.id}
                      className="flex items-center justify-between gap-4 py-2"
                      data-testid={`workflow-run-row-${run.id}`}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <a
                          href={run.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            textLinkUnderlineClassName,
                            "inline-flex max-w-full items-center gap-1 truncate",
                          )}
                        >
                          {run.name}
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                        <span className="text-muted-foreground truncate text-xs">
                          {run.branch}
                          {" · "}
                          {run.requestedBy
                            ? tr("workflows.byMember", {
                                args: [run.requestedBy],
                              })
                            : run.event}
                          {run.createdAt ? (
                            <>
                              {" · "}
                              <TimeAgo value={run.createdAt} />
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant="tint" tone={ProjectWorkflows.tone(run)}>
                          {ProjectWorkflows.moving(run)
                            ? run.status === "queued"
                              ? tr("workflows.status.queued")
                              : tr("workflows.status.running")
                            : run.conclusion === "success"
                              ? tr("workflows.status.success")
                              : run.conclusion === "cancelled"
                                ? tr("workflows.status.cancelled")
                                : run.conclusion === "skipped"
                                  ? tr("workflows.status.skipped")
                                  : tr("workflows.status.failure")}
                        </Badge>
                        {canRun &&
                          (ProjectWorkflows.moving(run) ? (
                            <Button
                              size="sm"
                              variant="minimal"
                              disabled={act.loading}
                              title={tr("workflows.cancelRun")}
                              aria-label={tr("workflows.cancelRun")}
                              onClick={() => void act.run(run, "cancel")}
                            >
                              <Square className="size-3.5" />
                            </Button>
                          ) : (
                            <>
                              {run.conclusion === "failure" && (
                                <Button
                                  size="sm"
                                  variant="minimal"
                                  disabled={act.loading}
                                  onClick={() => void act.run(run, "failed")}
                                >
                                  {tr("workflows.rerunFailed")}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="minimal"
                                disabled={act.loading}
                                title={tr("workflows.rerun")}
                                aria-label={tr("workflows.rerun")}
                                onClick={() => void act.run(run, "rerun")}
                              >
                                <RotateCcw className="size-3.5" />
                              </Button>
                            </>
                          ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
      {running && (
        <WorkflowRunDialog
          projectId={project.id}
          workflow={running}
          defaultBranch={data?.defaultBranch}
          onStarted={() => setLive(true)}
          onOpenChange={(open) => {
            if (!open) setRunning(undefined);
          }}
        />
      )}
    </div>
  );
};

ProjectWorkflows.moving = (run: WorkflowRun): boolean =>
  run.status !== "completed";

ProjectWorkflows.tone = (
  run: WorkflowRun,
): "success" | "danger" | "warning" | "neutral" =>
  ProjectWorkflows.moving(run)
    ? "warning"
    : run.conclusion === "success"
      ? "success"
      : run.conclusion === "cancelled" || run.conclusion === "skipped"
        ? "neutral"
        : "danger";

export default ProjectWorkflows;
