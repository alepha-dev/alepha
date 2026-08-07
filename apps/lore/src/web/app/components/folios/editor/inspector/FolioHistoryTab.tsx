import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  ChevronRight,
  Clock,
  FilePlus2,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Tag,
  Type,
} from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { FolioRevision } from "@/api/entities/folioRevisions.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioHistoryTabProps {
  folio: Folio;
  /**
   * Changes whenever a save completes elsewhere in the workspace (the
   * chrome row's Save button, an unlock, an encrypt/remove-protection
   * transition) — `useFolioDraft`'s `savedAt`, threaded down through
   * `FolioInspector`. Included in the fetch effect's deps so THIS
   * component re-fetches after a save it didn't itself trigger, not just
   * on mount. Without it, `props.folio` (the route-loader snapshot,
   * frozen for the mount's lifetime, same premise as everywhere else in
   * this workspace) never changes identity on a same-folio save, so the
   * revision list — and the count `FolioMetaBar` reads — would silently
   * go stale the moment the user typed and hit Save while sitting on a
   * different inspector tab. Found live while verifying this task.
   */
  refreshedAt?: string;
  /**
   * Fired after a successful revert — the caller (`useFolioActions`'s
   * `applyReverted`) re-syncs the draft buffer and the shared atoms, since
   * the server-reverted row does not otherwise reach this component's own
   * `props.folio` (a route-loader snapshot, frozen for the mount's
   * lifetime — same premise as everywhere else in this workspace).
   */
  onReverted: (folio: Folio) => void;
  /**
   * Fired whenever the revision list changes (load, revert, pin toggle) so
   * `FolioMetaBar`'s "$3 revisions" count stays in sync without its own
   * fetch.
   */
  onRevisionCount: (count: number) => void;
}

const ActionLabel = (props: { action: FolioRevision["action"] }) => {
  const { tr } = useI18n<I18n, "en">();
  switch (props.action) {
    case "create":
      return <>{tr("folios.history.action.create")}</>;
    case "edit":
      return <>{tr("folios.history.action.edit")}</>;
    case "rename":
      return <>{tr("folios.history.action.rename")}</>;
    case "tag-change":
      return <>{tr("folios.history.action.tag-change")}</>;
    case "revert":
      return <>{tr("folios.history.action.revert")}</>;
  }
};

const actionIcon = (action: FolioRevision["action"]) => {
  switch (action) {
    case "create":
      return <FilePlus2 className="size-4" />;
    case "edit":
      return <Pencil className="size-4" />;
    case "rename":
      return <Type className="size-4" />;
    case "tag-change":
      return <Tag className="size-4" />;
    case "revert":
      return <RotateCcw className="size-4" />;
  }
};

/**
 * The History tab: revision list, ported wholesale from the deleted
 * `FolioHistoryPanel.tsx` (its `listHistory` / `revertHistory` /
 * `pinHistory` calls, expand-on-click rows, and the `grid-rows-[0fr]` →
 * `[1fr]` collapse animation are all unchanged — only the surrounding
 * chrome is restyled for the inspector).
 *
 * One thing this restyle deliberately does NOT add: an "agent" vs. "web"
 * author badge. Nothing in `folio_revisions` (or anywhere else in the
 * data model) records how a revision was made — `byUserId` is the same
 * column whether the edit came from the browser or from an MCP tool call,
 * because both authenticate as the same underlying user. Rendering a
 * badge would mean guessing, and a confidently wrong "agent"/"web" label
 * is worse than not showing one — see the task report.
 */
const FolioHistoryTab = (props: FolioHistoryTabProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const folioApi = useClient<FolioController>();

  const [revisions, setRevisions] = useState<FolioRevision[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    folioApi
      .listHistory({ params: { id: props.folio.id } })
      .then((rows) => {
        if (alive) setRevisions(rows);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [props.folio.id, props.refreshedAt, folioApi]);

  // Deliberately fires on every change to `revisions` (initial load,
  // revert, pin toggle), not just once — the meta bar's count should
  // never lag behind what this tab itself is showing.
  useEffect(() => {
    props.onRevisionCount(revisions.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisions]);

  const refresh = async () => {
    const next = await folioApi.listHistory({
      params: { id: props.folio.id },
    });
    setRevisions(next);
  };

  const handleRevert = async (revisionId: string) => {
    const confirmed = await dialog.confirm({
      title: tr("folios.history.revert-confirm-title"),
      description: tr("folios.history.revert-confirm-body"),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const updated = await folioApi.revertHistory({
        params: { id: props.folio.id, revisionId },
      });
      // No `refresh()` call here (unlike `handlePinToggle` below, which
      // still needs one). `onReverted` (`useFolioActions.applyReverted`)
      // always re-baselines `useFolioDraft.savedAt` on a successful
      // revert — even when the folio is protected and still locked, see
      // that function's own doc — and `savedAt` is threaded down as
      // `props.refreshedAt`, which sits in this component's own fetch
      // effect's deps above. That effect re-fires and re-fetches on its
      // own; calling `refresh()` here too was a second, redundant
      // `listHistory` GET landing at almost the same moment, for the
      // same reason, every single revert.
      await props.onReverted(updated as Folio);
    } finally {
      setBusy(false);
    }
  };

  const handlePinToggle = async (revision: FolioRevision) => {
    await folioApi.pinHistory({
      params: { id: props.folio.id, revisionId: revision.id },
      body: { pinned: !revision.pinned },
    });
    await refresh();
  };

  if (revisions.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
        {tr("folios.editor.inspector.history-empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="divide-border flex flex-col divide-y">
        {revisions.map((revision, index) => {
          const isExpanded = expandedId === revision.id;
          // Diff against the next-older revision so the user sees what
          // *this* edit changed. The newest entry (index 0) cannot be
          // reverted onto itself.
          const previous = revisions[index + 1];
          const isNewest = index === 0;
          const toggle = () => setExpandedId(isExpanded ? null : revision.id);
          return (
            <div key={revision.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
                className="hover:bg-accent/50 flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 transition-colors"
              >
                <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
                  {actionIcon(revision.action)}
                </span>
                <div className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium leading-tight">
                    <ActionLabel action={revision.action} />
                  </span>
                  <span className="text-muted-foreground folio-mono flex items-center gap-1 text-[11px] leading-tight">
                    <Clock className="size-3 shrink-0" />
                    {dt.of(revision.at).fromNow()}
                    {revision.pinned && (
                      <>
                        <span aria-hidden>·</span>
                        <Pin className="size-3 shrink-0" />
                        {tr("folios.history.pinned-badge")}
                      </>
                    )}
                  </span>
                </div>

                {/* Actions: intercept clicks so the menu never toggles the row. */}
                <div
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label={tr("folios.history.actions")}
                        />
                      }
                    >
                      <MoreVertical className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handlePinToggle(revision)}
                      >
                        {revision.pinned ? (
                          <PinOff className="size-4" />
                        ) : (
                          <Pin className="size-4" />
                        )}
                        {tr(
                          revision.pinned
                            ? "folios.history.unpin"
                            : "folios.editor.inspector.keep",
                        )}
                      </DropdownMenuItem>
                      {!isNewest && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleRevert(revision.id)}
                            disabled={busy}
                          >
                            <RotateCcw className="size-4" />
                            {tr("folios.editor.inspector.revert")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
                  <ChevronRight
                    className={cn(
                      "size-4 transition-transform duration-200",
                      isExpanded && "rotate-90",
                    )}
                  />
                </span>
              </div>

              {/* Animated collapse: grid-rows 0fr→1fr interpolates height
                  without measuring. Body stays mounted so it transitions. */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <div className="border-t px-3 py-2.5">
                    <DiffView revision={revision} previous={previous} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground/80 border-t px-3 py-2.5 text-[11px]">
        {tr("folios.editor.inspector.history-footer")}
      </p>
    </div>
  );
};

/**
 * Side-by-side "before / after" snapshot view. Not a token-level diff —
 * the spec calls for a "markdown-aware diff" but that's its own feature.
 * Two readable blocks, tinted `--destructive` (before) / `--primary`
 * (after) at low alpha, are enough for v1.
 */
const DiffView = (props: {
  revision: FolioRevision;
  previous?: FolioRevision;
}) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {props.previous && (
        <div>
          <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">
            {tr("folios.history.diff-before")}
          </div>
          <SnapshotBlock revision={props.previous} tone="before" />
        </div>
      )}
      <div>
        <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">
          {tr("folios.history.diff-after")}
        </div>
        <SnapshotBlock revision={props.revision} tone="after" />
      </div>
    </div>
  );
};

const SnapshotBlock = (props: {
  revision: FolioRevision;
  tone: "before" | "after";
}) => (
  <pre
    className={cn(
      "max-h-72 overflow-auto whitespace-pre-wrap rounded p-2 text-[11px]",
      props.tone === "before" ? "bg-destructive/10" : "bg-primary/10",
    )}
  >
    <div className="text-foreground/80 mb-1 text-xs font-semibold">
      {props.revision.titleSnapshot}
    </div>
    {props.revision.tagsSnapshot.length > 0 && (
      <div className="text-muted-foreground mb-1 text-[10px]">
        {props.revision.tagsSnapshot.map((t) => `#${t}`).join(" ")}
      </div>
    )}
    {props.revision.contentSnapshot}
  </pre>
);

export default FolioHistoryTab;
