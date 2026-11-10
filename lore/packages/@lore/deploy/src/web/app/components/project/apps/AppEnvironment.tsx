import { Badge, Button, TimeAgo } from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { FileUp, KeyRound, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { AppSecretController } from "../../../../../api/controllers/AppSecretController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import AppEnvironmentAdd from "./AppEnvironmentAdd.tsx";
import AppEnvironmentImport from "./AppEnvironmentImport.tsx";
import {
  type AppEnvironmentItem,
  useAppEnvironmentActions,
} from "./useAppEnvironmentActions.ts";

/**
 * The Environment tab: what this deployed copy runs with, as one table.
 *
 * Laid out after Cloudflare's own "Variables and secrets": the title and its
 * count lead the table's toolbar, Add and Import sit at its end, and each row
 * shows its edit and remove buttons rather than a menu, since those are the
 * only two things a row does.
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
  const [adding, setAdding] = useState(false);
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
    <div className="flex flex-col gap-4 p-4" data-testid="app-environment">
      {/*
        The error state is the tab's own, and the empty one is not it:
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
          hideColumnPicker
          hideActionsMenu
          cellPadding="large"
          // A copy carries at most a hundred keys: one list, no pager.
          pagination={false}
          striped
          chromeClassName="bg-card"
          rowActionsDisplay="inline"
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
          leading={
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">{tr("app.environment")}</h2>
              {items.length > 0 ? (
                <Badge variant="tint">{items.length}</Badge>
              ) : null}
            </div>
          }
          help={<p>{tr("app.environment.description")}</p>}
          toolbar={
            canDeploy ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => setImporting(true)}
                  data-testid="app-environment-import"
                >
                  <FileUp className="size-4" aria-hidden />
                  {tr("app.environment.import")}
                </Button>
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => setAdding(true)}
                  data-testid="app-environment-add"
                >
                  <Plus className="size-4" aria-hidden />
                  {tr("app.environment.add")}
                </Button>
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">
                {tr("app.environment.notAllowed")}
              </span>
            )
          }
          emptyState={{
            icon: KeyRound,
            title: tr("app.environment.empty"),
          }}
          columns={{
            kind: {
              label: tr("app.environment.kind"),
              sortable: true,
              className: "w-28",
              cell: (row) =>
                tr(
                  row.kind === "variable"
                    ? "app.environment.kind.variable"
                    : "app.environment.kind.secret",
                ),
            },
            key: {
              label: tr("app.environment.key"),
              sortable: true,
              cell: (row) => (
                <span className="font-mono text-sm">{row.key}</span>
              ),
            },
            value: {
              label: tr("app.environment.value"),
              cell: (row) =>
                row.kind === "variable" ? (
                  <span
                    className="block max-w-md truncate font-mono text-sm"
                    title={row.value}
                  >
                    {row.value}
                  </span>
                ) : (
                  <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                    <Lock className="size-3.5" aria-hidden />
                    <span className="italic">
                      {tr("app.environment.encrypted")}
                    </span>
                    {/* A Bay copy's key is the machine's own, escrowed by
                        Bay: no person set it, which is what an empty
                        updatedBy says here. */}
                    {row.key === "APP_SECRET" &&
                    !row.updatedBy &&
                    (data?.reserved ?? []).includes("APP_SECRET") ? (
                      <span className="text-xs">
                        {tr("app.environment.setByMachine")}
                      </span>
                    ) : null}
                    {row.valuePrefix ? (
                      <span className="text-xs">
                        {tr("app.environment.masked", {
                          args: [row.valuePrefix],
                        })}
                      </span>
                    ) : null}
                  </span>
                ),
            },
            updatedAt: {
              label: tr("app.environment.updated"),
              sortable: true,
              className: "w-32",
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

      {canDeploy ? (
        <>
          <AppEnvironmentAdd
            open={adding}
            onOpenChange={setAdding}
            projectId={project.id}
            instanceId={instance.id}
            declared={declared}
            taken={taken}
          />
          <AppEnvironmentImport
            open={importing}
            onOpenChange={setImporting}
            projectId={project.id}
            instanceId={instance.id}
            taken={taken}
            reserved={data?.reserved ?? []}
          />
        </>
      ) : null}
    </div>
  );
};

export default AppEnvironment;
