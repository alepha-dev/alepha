import {
  Badge,
  Button,
  useDialog,
  useToast,
  cn,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import { type BulkAction, DataTable } from "@alepha/ui/table";
import { descriptionSnippet, type I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { isHttpError } from "alepha/server";
import { Combine, MapPin } from "lucide-react";
import { useState } from "react";

import type { AreaController } from "../../../../../api/controllers/AreaController.ts";
import type { AreaResource } from "../../../../../api/schemas/areaResourceSchema.ts";
import AreaMergeDialog from "./AreaMergeDialog.tsx";

export interface ProjectSettingsAreasPageProps {
  areas: AreaResource[];
}

/**
 * Areas settings list: real per-area stats, multi-select, and the bulk
 * merge that is the whole point of this rework, on the shared `DataTable`
 * and its own selection since #Q4185. Renaming a
 * single area (and merging by rename-onto-collision) lives on the
 * detail page (`projectSettingsArea`) now; this page's job is
 * navigation, stats, bulk merge, and deleting areas that hold no quests.
 */
const ProjectSettingsAreasPage = (props: ProjectSettingsAreasPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const dt = useInject(DateTimeProvider);
  const router = useRouter();
  const areaApi = useClient<AreaController>();
  // The rows being merged, and the table's own way to clear its selection
  // once they are: the selection lives in the `DataTable`.
  const [merging, setMerging] = useState<
    { sources: AreaResource[]; clear: () => void } | undefined
  >();

  const reload = async () => {
    await router.push(router.pathname, { force: true });
  };

  // One permission behind three areas verbs on the server, so one flag here.
  const canManage = areaApi.deleteArea.can();

  // The area whose delete runs: its row's button spins, the others wait.
  const [removingId, setRemovingId] = useState<number>();
  const removeAction = useAction<[area: AreaResource], void>(
    {
      handler: async (_ctx, area) => {
        const ok = await dialog.confirm({
          title: tr("project.settings.areas.delete.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await areaApi.deleteArea({ params: { id: area.id } });
        await reload();
      },
      // The row only offers this button when the loader's snapshot showed
      // `questCount === 0`, but a quest can land here between that read and
      // this click (another tab, another member). The server's own refusal
      // is authoritative; its friendlier localized wording is shown instead
      // of the raw `BadRequestError` message. Toasted here, since an
      // `onError` marks the failure handled and the root listener skips it.
      onError: (error) =>
        toaster.error(
          isHttpError(error, 400)
            ? tr("project.settings.areas.delete.blocked")
            : error.message,
        ),
    },
    [areaApi, dialog, toaster, tr],
  );

  const bulkActions: BulkAction<AreaResource>[] = canManage
    ? [
        {
          icon: Combine,
          label: tr("project.settings.areas.merge.action"),
          onClick: (selected, ctx) =>
            setMerging({ sources: selected, clear: ctx.clearSelection }),
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <MapPin className="size-5" />
        <h2 className="text-base font-semibold">
          {tr("project.settings.areas.title")}
        </h2>
      </div>
      <p className="text-muted-foreground text-sm">
        {tr("project.settings.areas.description")}
      </p>

      <DataTable<AreaResource>
        data={props.areas}
        pagination={false}
        rowKey={(area) => String(area.id)}
        bulkActions={bulkActions}
        emptyState={{
          icon: MapPin,
          title: tr("project.settings.areas.empty"),
        }}
        columns={{
          name: {
            label: tr("project.settings.areas.column.name"),
            sortable: true,
            sortValue: (area) => area.name,
            cell: (area) => (
              <Link
                href={router.path("projectSettingsArea", {
                  params: {
                    projectSlug: router.state.params.projectSlug,
                    areaId: area.id,
                  },
                })}
                className={cn(
                  textLinkUnderlineClassName,
                  "hover:text-foreground font-medium",
                )}
              >
                {area.name}
              </Link>
            ),
          },
          summary: {
            label: tr("project.settings.areas.column.summary"),
            cell: (area) => (
              <span className="text-muted-foreground block max-w-64 truncate text-xs">
                {descriptionSnippet(area.description)}
              </span>
            ),
          },
          open: {
            label: tr("project.settings.areas.column.open"),
            sortable: true,
            sortValue: (area) => area.openQuestCount,
            cell: (area) => (
              <Badge variant="outline">{area.openQuestCount}</Badge>
            ),
          },
          total: {
            label: tr("project.settings.areas.column.total"),
            sortable: true,
            sortValue: (area) => area.questCount,
            cell: (area) => (
              <span className="text-muted-foreground text-xs">
                {area.questCount}
              </span>
            ),
          },
          lastActivity: {
            label: tr("project.settings.areas.column.lastActivity"),
            sortable: true,
            sortValue: (area) => area.lastQuestAt ?? "",
            cell: (area) => (
              <span className="text-muted-foreground text-xs">
                {area.lastQuestAt
                  ? dt.of(area.lastQuestAt).fromNow()
                  : tr("project.settings.areas.never")}
              </span>
            ),
          },
          // The delete stays a button on the row, offered only on an area
          // that holds no quests: it is the row's one write.
          actions: {
            label: "",
            cell: (area) =>
              area.questCount === 0 && canManage ? (
                <Button
                  variant="minimal"
                  size="sm"
                  disabled={removeAction.loading}
                  loading={removeAction.loading && removingId === area.id}
                  onClick={() => {
                    setRemovingId(area.id);
                    void removeAction
                      .run(area)
                      .finally(() => setRemovingId(undefined));
                  }}
                >
                  {tr("project.settings.areas.delete.action")}
                </Button>
              ) : null,
          },
        }}
      />

      <AreaMergeDialog
        open={merging !== undefined}
        sources={merging?.sources ?? []}
        candidates={props.areas.filter(
          (area) => !merging?.sources.some((it) => it.id === area.id),
        )}
        onClose={() => setMerging(undefined)}
        onMerged={() => {
          merging?.clear();
          void reload();
        }}
      />
    </div>
  );
};

export default ProjectSettingsAreasPage;
