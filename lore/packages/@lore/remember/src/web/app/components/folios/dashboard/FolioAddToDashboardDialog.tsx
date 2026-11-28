import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import type { ProjectDashboardController } from "@lore/core/api";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useState } from "react";

export interface FolioAddToDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folio: { shortId: number; title: string };
}

/**
 * Folio ▸ Add to dashboard… (#E144, #Q3520): pick one of the project's
 * dashboards and the folio lands there as a Folio card, showing what fits
 * it. The computed default board has no cards of its own to add to, so it
 * is customized first, as the dashboard itself does, and the toast says so.
 */
const FolioAddToDashboardDialog = (
  props: FolioAddToDashboardDialogProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const boardApi = useClient<ProjectDashboardController>();
  const projectId = project?.id;

  const boards = useQuery(
    {
      key: ["project-dashboards", projectId],
      enabled: props.open && projectId !== undefined,
      handler: async () =>
        (
          await boardApi.listProjectDashboards({
            params: { projectId: projectId! },
          })
        ).dashboards,
    },
    [boardApi, projectId, props.open],
  );

  // The dashboard picked: its button spins while the folio is added.
  const [picked, setPicked] = useState<number | "first">();
  const add = useAction<
    [dashboard: { id?: number; slug?: string; name?: string }],
    void
  >(
    {
      handler: async (_ctx, dashboard) => {
        if (projectId === undefined) return;
        const board = await boardApi.getProjectDashboard({
          params: { projectId },
          query: dashboard.slug ? { dashboard: dashboard.slug } : {},
        });
        const query =
          dashboard.id !== undefined ? { dashboardId: dashboard.id } : {};
        if (board.computed) {
          await boardApi.customizeProjectDashboard({
            params: { projectId },
            query,
          });
        }
        await boardApi.addProjectDashboardCard({
          params: { projectId },
          query,
          body: {
            metric: "folio",
            scope: { kind: "projects", projectIds: [projectId] },
            filters: { folio: props.folio.shortId, show: "auto" },
          },
        });
        const name = dashboard.name ?? tr("folios.dashboard.default-name");
        toaster.success(
          board.computed
            ? tr("folios.dashboard.added-customized", { args: [name] })
            : tr("folios.dashboard.added", { args: [name] }),
        );
        props.onOpenChange(false);
      },
    },
    [boardApi, projectId, props.folio.shortId],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{tr("folios.dashboard.title")}</DialogTitle>
          <DialogDescription>
            {tr("folios.dashboard.description", { args: [props.folio.title] })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {(boards.data ?? []).map((dashboard) => (
            <Button
              key={dashboard.id ?? "first"}
              variant="outlined"
              className="justify-start"
              disabled={add.loading}
              loading={add.loading && picked === (dashboard.id ?? "first")}
              onClick={() => {
                setPicked(dashboard.id ?? "first");
                void add.run(dashboard).finally(() => setPicked(undefined));
              }}
            >
              {dashboard.name ?? tr("folios.dashboard.default-name")}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FolioAddToDashboardDialog;
