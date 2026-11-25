import {
  Badge,
  Button,
  cn,
  textLinkUnderlineClassName,
  useDialog,
  useToast,
} from "@alepha/ui";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import { type I18n, useRank } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { FileUp, Layers, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";

import type { StackController } from "../../../../../api/controllers/StackController.ts";
import type { StackResource } from "../../../../../api/schemas/stackResourceSchema.ts";
import StackCreateDialog from "./StackCreateDialog.tsx";
import StackEnvironmentAddDialog from "./StackEnvironmentAddDialog.tsx";
import StackRevisionUploadDialog from "./StackRevisionUploadDialog.tsx";
import { useProjectStacks } from "./useProjectStacks.ts";

/**
 * Every stack of the project (#Q2696), in a `DataTable` like the Apps page
 * (#Q4320): its name and latest revision, its default host, its
 * environments (each a link to its page) and the apps it runs. New stack,
 * Add environment and Upload compose open centered dialogs; a stack with no
 * environment left can be deleted from its row.
 */
const ProjectStacks = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const dialog = useDialog();
  const toaster = useToast();
  const api = useClient<StackController>();
  const { project, stacks, hosts, loading } = useProjectStacks();
  const [open, setOpen] = useState<
    | { kind: "create" }
    | { kind: "environment" | "revision"; stack: StackResource }
    | undefined
  >();
  const canWrite = can("deploy:manage");

  const remove = useAction<[stack: StackResource], boolean>(
    {
      handler: async (_context, stack) => {
        if (!project) return false;
        const confirmed = await dialog.confirm({
          title: tr("stacks.delete.confirm", { args: [stack.name] }),
          description: tr("stacks.delete.description"),
          confirmLabel: tr("stacks.delete"),
          destructive: true,
        });
        if (!confirmed) return false;
        await api.deleteStack({
          params: { projectId: project.id, stackId: stack.id },
        });
        toaster.success(tr("stacks.deleted"));
        return true;
      },
      invalidates: [["stacks", project?.id]],
    },
    [api, dialog, toaster, tr, project?.id],
  );

  if (!project) {
    return null;
  }
  const slug = project.slug ?? String(project.id);
  const slugOf = (id: string | undefined) =>
    hosts.find((host) => host.id === id)?.slug;
  const hostOptions = hosts.map((host) => ({
    value: host.id,
    label: host.slug,
  }));

  const filterFields = {
    search: { preset: "search" },
    host: {
      schema: z.string(),
      label: tr("stacks.col.host"),
      icon: Server,
      items: hostOptions,
      hidden: hostOptions.length <= 1,
      control: { clearLabel: tr("stacks.col.host") },
    },
  } satisfies DataTableFilterFields;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-2"
      data-testid="project-stacks"
    >
      {loading && stacks.length === 0 ? null : (
        <DataTable<StackResource, typeof filterFields>
          className="min-h-0 flex-1"
          data={stacks}
          rowKey={(stack) => stack.id}
          persistenceKey={`lor.stacks.${project.id}`}
          persist={{ filters: false }}
          emptyState={{
            icon: Layers,
            title: tr("stacks.empty"),
            description: tr("stacks.empty.description"),
            action: canWrite ? (
              <Button onClick={() => setOpen({ kind: "create" })}>
                <Plus className="size-4" />
                {tr("stacks.create")}
              </Button>
            ) : undefined,
          }}
          noMatchState={{
            title: tr("stacks.noMatch"),
            description: tr("stacks.noMatch.description"),
          }}
          actions={
            canWrite
              ? [
                  {
                    icon: Plus,
                    label: tr("stacks.create"),
                    primary: true,
                    onClick: () => setOpen({ kind: "create" }),
                  },
                ]
              : []
          }
          defaultSort={{ field: "name", direction: "asc" }}
          filters={{ fields: filterFields }}
          filter={(stack, values) => {
            const search = (values.search ?? "").toLowerCase();
            if (
              search &&
              !stack.name.toLowerCase().includes(search) &&
              !stack.environments.some((it) =>
                it.env.toLowerCase().includes(search),
              )
            ) {
              return false;
            }
            if (
              values.host &&
              stack.hostId !== values.host &&
              !stack.environments.some((it) => it.hostId === values.host)
            ) {
              return false;
            }
            return true;
          }}
          rowActions={
            canWrite
              ? (stack) => [
                  {
                    icon: Plus,
                    label: tr("stacks.environment.add"),
                    onClick: () => setOpen({ kind: "environment", stack }),
                  },
                  {
                    icon: FileUp,
                    label: tr("stacks.revision.upload.title"),
                    onClick: () => setOpen({ kind: "revision", stack }),
                  },
                  // The server refuses while an environment remains: each
                  // one is forgotten first from its own Settings tab.
                  ...(stack.environments.length === 0
                    ? [
                        {
                          icon: Trash2,
                          label: tr("stacks.delete"),
                          destructive: true,
                          disabled: () => remove.loading,
                          onClick: () => void remove.run(stack),
                        },
                      ]
                    : []),
                ]
              : undefined
          }
          columns={{
            name: {
              label: tr("stacks.col.name"),
              sortable: true,
              cell: (stack) => (
                <span
                  className="flex items-center gap-2 font-medium"
                  data-testid={`stack-row-${stack.name}`}
                >
                  {stack.name}
                  {stack.latestRevision ? (
                    <Badge variant="outline">
                      {tr("stacks.revision.latest", {
                        args: [String(stack.latestRevision)],
                      })}
                    </Badge>
                  ) : null}
                </span>
              ),
            },
            hostId: {
              label: tr("stacks.create.host"),
              sortable: true,
              sortValue: (stack) => slugOf(stack.hostId),
              cell: (stack) =>
                slugOf(stack.hostId) ?? (
                  <span className="text-muted-foreground">
                    {tr("stacks.host.unset")}
                  </span>
                ),
            },
            environments: {
              label: tr("stacks.col.environments"),
              cell: (stack) =>
                stack.environments.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    {tr("stacks.environment.empty")}
                  </span>
                ) : (
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    {stack.environments.map((environment) => (
                      <Link
                        key={environment.id}
                        className={cn(
                          textLinkUnderlineClassName,
                          "hover:text-foreground",
                        )}
                        href={`/${slug}/stacks/${stack.name}/${environment.env}`}
                        title={[
                          slugOf(environment.hostId) ??
                            tr("stacks.host.default"),
                          environment.revision
                            ? tr("stacks.revision.latest", {
                                args: [String(environment.revision)],
                              })
                            : tr("stacks.revision.none"),
                        ].join(" · ")}
                        data-testid={`stack-environment-link-${environment.env}`}
                      >
                        {environment.env}
                      </Link>
                    ))}
                  </span>
                ),
            },
            members: {
              label: tr("stacks.col.members"),
              cell: (stack) =>
                [
                  ...new Set(
                    stack.environments.flatMap((environment) =>
                      environment.members.map((member) => member.app),
                    ),
                  ),
                ].join(", "),
            },
          }}
        />
      )}
      {open?.kind === "create" && (
        <StackCreateDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={project.id}
          hosts={hosts}
        />
      )}
      {open?.kind === "environment" && (
        <StackEnvironmentAddDialog
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={project.id}
          stackId={open.stack.id}
          stackName={open.stack.name}
        />
      )}
      {open?.kind === "revision" && (
        <StackRevisionUploadDialog
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={project.id}
          stackId={open.stack.id}
          stackName={open.stack.name}
        />
      )}
    </div>
  );
};

export default ProjectStacks;
