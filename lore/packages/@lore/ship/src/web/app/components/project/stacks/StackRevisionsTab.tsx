import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TimeAgo,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { type I18n, useRank } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";
import type { StackDeployController } from "../../../../../api/controllers/StackDeployController.ts";
import StackRevisionDiff from "./StackRevisionDiff.tsx";
import type { StackTarget } from "./stackTarget.ts";

export interface StackRevisionsTabProps {
  target: StackTarget;
  env: string;
}

/**
 * The stack's revisions, newest first: any two compared line by line, and
 * any one deployed again to this environment. A rollback brings the compose
 * file back, never the data in the volumes.
 */
const StackRevisionsTab = (props: StackRevisionsTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const dialog = useDialog();
  const toaster = useToast();
  const stackApi = useClient<StackController>();
  const deployApi = useClient<StackDeployController>();
  const { data } = useQuery(
    {
      key: ["stack-revisions", props.target.projectId, props.target.stackId],
      keepPreviousData: true,
      handler: async () =>
        await stackApi.listStackRevisions({
          params: {
            projectId: props.target.projectId,
            stackId: props.target.stackId,
          },
        }),
    },
    [props.target.stackId],
  );
  const revisions = data?.items ?? [];

  const form = useForm({
    id: `stack-revision-compare-${props.target.stackId}`,
    schema: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    initialValues: { from: "", to: "" },
    handler: () => {},
  });
  const values = useFormValues(form);
  const before =
    revisions.find((r) => String(r.number) === values.from) ?? revisions[1];
  const after =
    revisions.find((r) => String(r.number) === values.to) ?? revisions[0];

  const rollback = useAction<[revision: number], boolean>(
    {
      handler: async (_ctx, revision) => {
        const confirmed = await dialog.confirm({
          title: tr("stacks.revisions.rollback.confirm.title", {
            args: [String(revision), props.env],
          }),
          description: tr("stacks.revisions.rollback.confirm.description"),
          confirmLabel: tr("stacks.revisions.rollback"),
        });
        if (!confirmed) {
          return false;
        }
        await deployApi.rollbackStackEnvironment({
          params: props.target,
          body: { revision },
        });
        toaster.success(tr("stacks.deploys.queued"));
        return true;
      },
      invalidates: [
        [
          "stack-deployments",
          props.target.projectId,
          props.target.environmentId,
        ],
      ],
    },
    [deployApi, dialog, toaster, tr, props.target, props.env],
  );

  const items = revisions.map((r) => ({
    value: String(r.number),
    label: tr("stacks.revision.number", { args: [String(r.number)] }),
  }));

  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="stack-revisions">
        <CardHeader>
          <CardTitle className="text-base">
            {tr("stacks.tab.revisions")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y text-sm">
          {revisions.length === 0 ? (
            <p className="text-muted-foreground">
              {tr("stacks.revisions.empty")}
            </p>
          ) : null}
          {revisions.map((revision) => (
            <div
              key={revision.id}
              className="flex flex-wrap items-center gap-3 py-2"
              data-testid="stack-revision-row"
            >
              <span className="font-medium">
                {tr("stacks.revision.number", {
                  args: [String(revision.number)],
                })}
              </span>
              <span className="text-muted-foreground">
                <TimeAgo value={revision.createdAt} />
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                {revision.sha256.slice(0, 12)}
              </span>
              {can("deploy:manage") ? (
                <Button
                  size="sm"
                  variant="minimal"
                  className="ml-auto"
                  disabled={rollback.loading}
                  onClick={() => void rollback.run(revision.number)}
                >
                  {tr("stacks.revisions.rollback")}
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
      {revisions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {tr("stacks.revisions.compare")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-3">
              <div className="w-40">
                <Control
                  select
                  input={form.input.from}
                  label={tr("stacks.revisions.from")}
                  items={items}
                />
              </div>
              <div className="w-40">
                <Control
                  select
                  input={form.input.to}
                  label={tr("stacks.revisions.to")}
                  items={items}
                />
              </div>
            </div>
            {before && after ? (
              <StackRevisionDiff
                before={before.compose}
                after={after.compose}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default StackRevisionsTab;
