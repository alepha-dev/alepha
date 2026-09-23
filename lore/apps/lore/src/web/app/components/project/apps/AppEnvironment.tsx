import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  TimeAgo,
} from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { FileUp, KeyRound, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import type { AppSecretController } from "@/api/controllers/AppSecretController.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useRank } from "../../shared/useRank.ts";
import AppEnvironmentAdd from "./AppEnvironmentAdd.tsx";
import AppEnvironmentImport from "./AppEnvironmentImport.tsx";
import {
  type AppEnvironmentItem,
  useAppEnvironmentActions,
} from "./useAppEnvironmentActions.ts";

/**
 * The Environment tab: what this deployed copy runs with, as one table.
 *
 * ## Secrets and variables (#Q2467)
 *
 * A **variable** is a key the app's build declares `secret: false`: its value
 * is stored readable, shown in the table and edited in place. A **secret** is
 * everything else, undeclared keys included: write-only, shown as a prefix,
 * and replaced rather than edited. Which one a key is follows the app's
 * declaration when it is set, never a toggle here.
 *
 * ## ⚠️ A secret's value never reaches this page
 *
 * The endpoint answers a secret's name, a four-character prefix of a long
 * value and who set it last, to anybody, the project owner included. A
 * `type="password"` input would look like the same thing and ship the real
 * value to every browser that opened the tab.
 *
 * ## The empty state is the normal one
 *
 * A copy starts with no variables and deploys perfectly well with none:
 * `DATABASE_URL`, `R2_BUCKET_NAME` and the `CLOUDFLARE_*` names are derived by
 * the deploy from the resources it provisions, which is why they are refused
 * here rather than offered as fields to fill in.
 *
 * ⚠️ A UI affordance and not the boundary: a member sees the table read-only
 * because the write endpoints are gated server-side, and hiding a button
 * refuses nothing.
 */
const AppEnvironment = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const secretApi = useClient<AppSecretController>();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);
  const [importing, setImporting] = useState(false);

  const { data, loading, error } = useQuery(
    {
      enabled: Boolean(project && instance),
      // Invalidated by every write on this tab (#E59, #Q2329), and kept on
      // screen while it is re-read after one of them.
      key: ["app-secrets", project?.id, instance?.id],
      keepPreviousData: true,
      handler: async () => {
        if (!project || !instance) return undefined;
        return await secretApi.listAppSecrets({
          params: { projectId: project.id, instanceId: instance.id },
        });
      },
      // Handled: the card renders its own error state below, so the root
      // `ActionErrorToaster` must not toast the same failure on top of it.
      onError: () => {},
    },
    [project?.id, instance?.id],
  );

  const actions = useAppEnvironmentActions({
    projectId: project?.id ?? 0,
    instanceId: instance?.id ?? "",
  });

  if (!project || !instance) {
    return null;
  }

  const items = data?.items ?? [];
  const declared = data?.declared ?? [];
  const taken = items.map((item) => item.key);
  // Rank, not ownership: `deploy:manage` is its own permission and an owner
  // may have granted it to a rank. ⚠️ Never the boundary.
  const canDeploy = can("deploy:manage");

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card data-testid="app-environment">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">{tr("app.environment")}</CardTitle>
            <CardDescription>
              {tr("app.environment.description")}
            </CardDescription>
          </div>
          {canDeploy ? (
            <Button
              variant="outlined"
              size="sm"
              onClick={() => setImporting(true)}
              data-testid="app-environment-import"
            >
              <FileUp className="size-4" aria-hidden />
              {tr("app.environment.import")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {/*
            The error state is the card's own, and the empty one is not it:
            folding them together is how "nothing set" comes to read as
            "something is broken".
          */}
          {loading && !data ? (
            <p className="text-muted-foreground text-sm">
              {tr("app.environment.loading")}
            </p>
          ) : error ? (
            <p className="text-muted-foreground text-sm">
              {tr("app.environment.error")}
            </p>
          ) : (
            <DataTable<AppEnvironmentItem>
              data={items}
              rowKey={(row) => row.id}
              defaultSort={{ field: "key", direction: "asc" }}
              emptyState={{
                icon: KeyRound,
                title: tr("app.environment.empty"),
              }}
              rowActions={(row) =>
                canDeploy
                  ? [
                      {
                        icon: Pencil,
                        label: tr(
                          row.kind === "variable"
                            ? "app.environment.edit"
                            : "app.environment.replace",
                        ),
                        disabled: () => actions.busy,
                        onClick: (item: AppEnvironmentItem) =>
                          void actions.edit(item),
                      },
                      {
                        icon: Trash2,
                        label: tr("app.environment.remove"),
                        destructive: true,
                        disabled: () => actions.busy,
                        onClick: (item: AppEnvironmentItem) =>
                          void actions.remove(item),
                      },
                    ]
                  : []
              }
              columns={{
                key: {
                  label: tr("app.environment.key"),
                  sortable: true,
                  cell: (row) => (
                    <span className="font-mono text-sm">{row.key}</span>
                  ),
                },
                kind: {
                  label: tr("app.environment.kind"),
                  sortable: true,
                  cell: (row) => (
                    <Badge variant="tint">
                      {tr(
                        row.kind === "variable"
                          ? "app.environment.kind.variable"
                          : "app.environment.kind.secret",
                      )}
                    </Badge>
                  ),
                },
                value: {
                  label: tr("app.environment.value"),
                  cell: (row) =>
                    row.kind === "variable" ? (
                      <span
                        className="block truncate font-mono text-xs"
                        title={row.value}
                      >
                        {row.value}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {row.valuePrefix
                          ? tr("app.environment.masked", {
                              args: [row.valuePrefix],
                            })
                          : tr("app.environment.masked.short")}
                      </span>
                    ),
                },
                updatedAt: {
                  label: tr("app.environment.updated"),
                  sortable: true,
                  cell: (row) => (
                    <TimeAgo
                      value={row.updatedAt}
                      className="text-muted-foreground text-xs"
                    />
                  ),
                },
              }}
            />
          )}
        </CardContent>
      </Card>

      {canDeploy ? (
        <AppEnvironmentAdd
          projectId={project.id}
          instanceId={instance.id}
          declared={declared}
          taken={taken}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {tr("app.environment.ownerOnly")}
        </p>
      )}

      {canDeploy ? (
        <AppEnvironmentImport
          open={importing}
          onOpenChange={setImporting}
          projectId={project.id}
          instanceId={instance.id}
          taken={taken}
          reserved={data?.reserved ?? []}
        />
      ) : null}
    </div>
  );
};

export default AppEnvironment;
