import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { type I18n, useRank } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";
import type { StackEnvironmentResource } from "../../../../../api/schemas/stackEnvironmentResourceSchema.ts";
import type { StackTarget } from "./stackTarget.ts";
import { useStackServices } from "./useStackServices.ts";

export interface StackRoutesTabProps {
  target: StackTarget;
  environment: StackEnvironmentResource;
}

/**
 * The environment's full-domain routes beside the labels its compose file
 * carries. A label resolves against the base domain; a full domain is set
 * here, per environment, which is how an unmodified file gets routed.
 */
const StackRoutesTab = (props: StackRoutesTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<StackController>();
  const queries = useQueryClient();
  const { data } = useStackServices(props.target);
  const services = data?.services ?? [];
  const canWrite = can("deploy:manage");
  const target = {
    projectId: props.target.projectId,
    stackId: props.target.stackId,
    environmentId: props.target.environmentId,
  };

  const form = useForm({
    id: `stack-route-add-${props.target.environmentId}`,
    schema: z.object({
      service: z.string().min(1),
      domain: z.string().min(1).max(253),
    }),
    initialValues: { service: "", domain: "" },
    handler: async (input) => {
      await api.addStackRoute({
        params: target,
        body: { service: input.service, domain: input.domain.trim() },
      });
      queries.invalidate(["stacks", props.target.projectId]);
      form.reset();
      toaster.success(tr("stacks.routes.added"));
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  const remove = useAction<[domain: string], boolean>(
    {
      handler: async (_ctx, domain) => {
        await api.removeStackRoute({ params: target, query: { domain } });
        toaster.success(tr("stacks.routes.removed"));
        return true;
      },
      invalidates: [["stacks", props.target.projectId]],
    },
    [api, toaster, tr, props.target],
  );

  const base = props.environment.baseDomain;
  const labels = services.flatMap((s) =>
    s.routes.map((label) => ({
      service: s.name,
      host: label === "@" ? (base ?? "@") : base ? `${label}.${base}` : label,
    })),
  );

  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="stack-routes">
        <CardHeader>
          <CardTitle className="text-base">
            {tr("stacks.routes.title")}
          </CardTitle>
          <CardDescription>{tr("stacks.routes.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y text-sm">
          {props.environment.routes.length === 0 ? (
            <p className="text-muted-foreground">{tr("stacks.routes.empty")}</p>
          ) : null}
          {props.environment.routes.map((route) => (
            <div
              key={route.domain}
              className="flex items-center gap-3 py-2"
              data-testid="stack-route-row"
            >
              <span className="font-medium">{route.domain}</span>
              <span className="text-muted-foreground">{route.service}</span>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="minimal"
                  className="ml-auto"
                  disabled={remove.loading}
                  onClick={() => void remove.run(route.domain)}
                >
                  {tr("stacks.routes.remove")}
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
      {labels.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {tr("stacks.routes.labels")}
            </CardTitle>
            <CardDescription>
              {base
                ? tr("stacks.routes.labels.base", { args: [base] })
                : tr("stacks.routes.labels.estate")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {labels.map((label) => (
              <div
                key={`${label.service}-${label.host}`}
                className="flex gap-3"
              >
                <span className="font-medium">{label.host}</span>
                <span className="text-muted-foreground">{label.service}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {tr("stacks.routes.add")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void form.submit();
              }}
            >
              <div className="w-48" data-testid="stack-route-service">
                <Control
                  select
                  input={form.input.service}
                  label={tr("stacks.routes.service")}
                  items={services.map((s) => ({
                    value: s.name,
                    label: s.name,
                  }))}
                />
              </div>
              <div className="flex-1" data-testid="stack-route-domain">
                <Control
                  input={form.input.domain}
                  label={tr("stacks.routes.domain")}
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                data-testid="stack-route-save"
              >
                {tr("stacks.routes.add")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default StackRoutesTab;
