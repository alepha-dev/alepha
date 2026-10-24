import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TimeAgo,
  useToast,
} from "@alepha/ui";
import { type I18n, useRank } from "@lore/core/web";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect } from "react";

import type { StackDeployController } from "../../../../../api/controllers/StackDeployController.ts";
import type { StackTarget } from "./stackTarget.ts";

export interface StackDeploysTabProps {
  target: StackTarget;
  latestRevision?: number;
}

/**
 * The environment's deploy log, newest first, each with what Bay reported it
 * changed, and the button that deploys the newest revision. Polls while a
 * deploy is queued or running.
 */
const StackDeploysTab = (props: StackDeploysTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<StackDeployController>();
  const key = [
    "stack-deployments",
    props.target.projectId,
    props.target.environmentId,
  ];
  const { data, refetch } = useQuery(
    {
      key,
      keepPreviousData: true,
      handler: async () =>
        await api.listStackDeployments({ params: props.target }),
    },
    [props.target.environmentId],
  );

  const deploy = useAction<[], boolean>(
    {
      handler: async () => {
        await api.deployStackEnvironment({ params: props.target, body: {} });
        toaster.success(tr("stacks.deploys.queued"));
        return true;
      },
      invalidates: [key, ["stacks", props.target.projectId]],
    },
    [api, toaster, tr, props.target],
  );

  const items = data?.items ?? [];
  const live = items.some(
    (it) => it.status === "queued" || it.status === "running",
  );
  // The poll, and it stops itself once nothing is in flight.
  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(() => refetch(), 3_000);
    return () => clearInterval(timer);
  }, [live, refetch]);

  return (
    <Card data-testid="stack-deploys">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          {tr("stacks.deploys.title")}
        </CardTitle>
        {can("deploy:manage") && props.latestRevision ? (
          <Button
            disabled={deploy.loading}
            onClick={() => void deploy.run()}
            data-testid="stack-deploy"
          >
            {tr("stacks.deploys.deploy", {
              args: [String(props.latestRevision)],
            })}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col divide-y text-sm">
        {items.length === 0 ? (
          <p className="text-muted-foreground">{tr("stacks.deploys.none")}</p>
        ) : null}
        {items.map((row) => {
          const plan = row.plan
            ? (JSON.parse(row.plan) as {
                created?: string[];
                changed?: string[];
                removed?: string[];
              })
            : undefined;
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 py-2"
              data-testid="stack-deploy-row"
            >
              <Badge
                variant={
                  row.status === "failed"
                    ? "destructive"
                    : row.status === "succeeded"
                      ? "default"
                      : "outline"
                }
              >
                {row.status}
              </Badge>
              <span>
                {tr("stacks.revision.number", { args: [String(row.revision)] })}
              </span>
              <span className="text-muted-foreground">
                <TimeAgo value={row.createdAt} />
              </span>
              {plan ? (
                <span className="text-muted-foreground">
                  {tr("stacks.deploys.plan", {
                    args: [
                      String(plan.created?.length ?? 0),
                      String(plan.changed?.length ?? 0),
                      String(plan.removed?.length ?? 0),
                    ],
                  })}
                </span>
              ) : null}
              {row.step && row.status === "running" ? (
                <span className="text-muted-foreground">{row.step}</span>
              ) : null}
              {row.error ? (
                <span className="text-destructive">{row.error}</span>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default StackDeploysTab;
