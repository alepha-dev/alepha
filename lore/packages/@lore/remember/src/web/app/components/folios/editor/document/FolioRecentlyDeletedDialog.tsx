import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useDialog,
  useToast,
} from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useClient,
  useInject,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RotateCcw, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";

import type { FolioController } from "../../../../../../api/controllers/FolioController.ts";

export interface FolioRecentlyDeletedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A reader who may not write sees the list, without Restore and Delete
   * permanently.
   */
  readOnly?: boolean;
}

/**
 * Folio ▸ Recently deleted… (#Q3698): the project's deleted folios, each
 * with when it was deleted and the days left before the purge takes it,
 * Restore and Delete permanently. Where the Trash directory used to be.
 */
const FolioRecentlyDeletedDialog = (
  props: FolioRecentlyDeletedDialogProps,
): ReactElement => {
  const { tr, l } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<FolioController>();
  const queries = useQueryClient();
  const dialog = useDialog();
  const toast = useToast();
  const dateTime = useInject(DateTimeProvider);
  const projectId = project?.id ?? 0;
  const key = ["folios-deleted", projectId];

  const deleted = useQuery(
    {
      key,
      enabled: props.open && !!project,
      handler: ({ signal }) =>
        api.listDeletedFolios(
          { query: { projectId } },
          { request: { signal } },
        ),
    },
    [api, projectId, props.open],
  );

  const restore = useAction<[id: string, title: string], void>(
    {
      handler: async (_ctx, id, title) => {
        await api.restoreFolio({ params: { id }, body: { projectId } });
        toast.success(tr("folios.deleted.restored", { args: [title] }));
      },
      invalidates: [key, ["folioTree", projectId]],
    },
    [api, projectId],
  );

  const purge = useAction<[id: string, title: string], void>(
    {
      handler: async (_ctx, id, title) => {
        const confirmed = await dialog.confirm({
          title: tr("folios.deleted.purgeTitle", { args: [title] }),
          description: tr("folios.deleted.purgeBody"),
          confirmLabel: tr("folios.deleted.purge"),
          destructive: true,
        });
        if (!confirmed) return;
        await api.purgeFolio({ params: { id }, body: { projectId } });
        queries.invalidate(key);
      },
    },
    [api, projectId, queries],
  );

  const busy = restore.loading || purge.loading;
  const items = deleted.data?.items ?? [];
  // The folio whose restore or purge runs: that row's button spins.
  const [pendingId, setPendingId] = useState<(typeof items)[number]["id"]>();
  const runOn = (action: typeof restore, item: (typeof items)[number]) => {
    setPendingId(item.id);
    void action.run(item.id, item.title).finally(() => setPendingId(undefined));
  };
  const retention = deleted.data?.retentionDays ?? 30;
  const daysLeft = (deletedAt: string) =>
    Math.max(
      0,
      retention -
        Math.floor(
          (dateTime.nowMillis() - new Date(deletedAt).getTime()) / 86_400_000,
        ),
    );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("folios.deleted.title")}</DialogTitle>
          <DialogDescription>
            {tr("folios.deleted.description", { args: [String(retention)] })}
          </DialogDescription>
        </DialogHeader>
        {deleted.data && items.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            {tr("folios.deleted.empty")}
          </p>
        ) : (
          <ul
            className="flex max-h-96 flex-col divide-y overflow-y-auto"
            data-testid="folios-deleted"
          >
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {tr("folios.deleted.deletedOn", {
                      args: [l(item.deletedAt, { date: "lll" })],
                    })}
                    {" · "}
                    {tr("folios.deleted.daysLeft", {
                      args: [String(daysLeft(item.deletedAt))],
                    })}
                  </p>
                </div>
                {!props.readOnly && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outlined"
                      disabled={busy}
                      loading={restore.loading && pendingId === item.id}
                      onClick={() => runOn(restore, item)}
                    >
                      <RotateCcw className="size-3.5" />
                      {tr("folios.deleted.restore")}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="minimal"
                      disabled={busy}
                      loading={purge.loading && pendingId === item.id}
                      aria-label={tr("folios.deleted.purge")}
                      title={tr("folios.deleted.purge")}
                      onClick={() => runOn(purge, item)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FolioRecentlyDeletedDialog;
