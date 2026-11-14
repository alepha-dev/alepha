import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { type I18n, useRank } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQuery, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";
import type { StackVariableController } from "../../../../../api/controllers/StackVariableController.ts";
import type { StackModel } from "../../../../../api/schemas/stackModelSchema.ts";
import type { StackTarget } from "./stackTarget.ts";

export interface StackVariablesTabProps {
  target: StackTarget;
}

/**
 * The environment's variables, write-only like an app's Environment tab: a
 * name, a short prefix of a long value, whether Lore generated it. The ones
 * the newest revision needs and this environment lacks are named first,
 * since a deploy is refused until they are set.
 */
const StackVariablesTab = (props: StackVariablesTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const dialog = useDialog();
  const toaster = useToast();
  const api = useClient<StackVariableController>();
  const stackApi = useClient<StackController>();
  const queries = useQueryClient();
  const key = [
    "stack-variables",
    props.target.projectId,
    props.target.environmentId,
  ];

  const { data } = useQuery(
    {
      key,
      keepPreviousData: true,
      handler: async () =>
        await api.listStackVariables({ params: props.target }),
    },
    [props.target.environmentId],
  );
  const revisions = useQuery(
    {
      key: ["stack-revisions", props.target.projectId, props.target.stackId],
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
  const items = data?.items ?? [];
  const newest = revisions.data?.items[0];
  const set = new Set(items.map((i) => i.key));
  const missing = newest
    ? (JSON.parse(newest.model) as StackModel).variables
        .filter((v) => v.required && !set.has(v.name))
        .map((v) => v.name)
    : [];

  const form = useForm({
    id: `stack-variable-add-${props.target.environmentId}`,
    schema: z.object({
      key: z.string().min(1).max(100),
      value: z.string().max(5_000).optional(),
      generate: z.boolean().optional(),
    }),
    initialValues: { key: "", value: "", generate: false },
    handler: async (input) => {
      await api.setStackVariable({
        params: props.target,
        body: input.generate
          ? { key: input.key.trim(), generate: 64 }
          : { key: input.key.trim(), value: input.value ?? "" },
      });
      queries.invalidate(key);
      form.reset();
      toaster.success(tr("stacks.variables.saved"));
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  const remove = useAction<[name: string], boolean>(
    {
      handler: async (_ctx, name) => {
        const confirmed = await dialog.confirm({
          title: tr("stacks.variables.remove.confirm", { args: [name] }),
          confirmLabel: tr("stacks.variables.remove"),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await api.removeStackVariable({
          params: props.target,
          query: { key: name },
        });
        toaster.success(tr("stacks.variables.removed"));
        return true;
      },
      invalidates: [key],
    },
    [api, dialog, toaster, tr, props.target],
  );

  const canWrite = can("deploy:manage");

  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="stack-variables">
        <CardHeader>
          <CardTitle className="text-base">
            {tr("stacks.variables.title")}
          </CardTitle>
          <CardDescription>
            {tr("stacks.variables.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y text-sm">
          {missing.length > 0 ? (
            <p
              className="text-destructive py-2"
              data-testid="stack-variables-missing"
            >
              {tr("stacks.variables.missing", { args: [missing.join(", ")] })}
            </p>
          ) : null}
          {items.length === 0 ? (
            <p className="text-muted-foreground py-2">
              {tr("stacks.variables.empty")}
            </p>
          ) : null}
          {items.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-3 py-2"
              data-testid="stack-variable-row"
            >
              <span className="font-mono font-medium">{item.key}</span>
              {item.valuePrefix ? (
                <span className="text-muted-foreground font-mono">{`${item.valuePrefix}…`}</span>
              ) : null}
              {item.generated ? (
                <Badge variant="outline">
                  {tr("stacks.variables.generated")}
                </Badge>
              ) : null}
              {canWrite ? (
                <Button
                  size="sm"
                  variant="minimal"
                  className="ml-auto"
                  disabled={remove.loading}
                  onClick={() => void remove.run(item.key)}
                >
                  {tr("stacks.variables.remove")}
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
      {canWrite ? (
        <Card>
          <CardContent className="pt-4">
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void form.submit();
              }}
            >
              <div className="flex-1" data-testid="stack-variable-key">
                <Control
                  input={form.input.key}
                  label={tr("stacks.variables.key")}
                />
              </div>
              <div className="flex-1" data-testid="stack-variable-value">
                <Control
                  input={form.input.value}
                  label={tr("stacks.variables.value")}
                />
              </div>
              <div data-testid="stack-variable-generate">
                <Control
                  input={form.input.generate}
                  label={tr("stacks.variables.generate")}
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                data-testid="stack-variable-save"
              >
                {tr("stacks.variables.save")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default StackVariablesTab;
