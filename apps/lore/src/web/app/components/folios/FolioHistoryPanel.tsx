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
import { useEffect, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { FolioRevision } from "@/api/entities/folioRevisions.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "../../services/I18n.ts";

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

interface FolioHistoryPanelProps {
  folio: Folio;
  onReverted: (folio: Folio) => void;
}

/**
 * Folio revision history, styled as a flush "history bar" — one square row
 * per revision in a single bordered stack, mirroring the Admin → Parameters
 * History bar (`@alepha/ui` `parameter-history-item`). The whole row toggles
 * the before/after diff; the `…` menu (Pin / Revert) stops propagation so it
 * never toggles the row. Feedback #15.
 */
const FolioHistoryPanel = (props: FolioHistoryPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const folioApi = useClient<FolioController>();

  const [revisions, setRevisions] = useState<FolioRevision[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
  }, [props.folio.id, folioApi]);

  const [busy, setBusy] = useState(false);

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
      props.onReverted(updated as Folio);
      await refresh();
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

  if (revisions.length === 0) return null;

  return (
    <section>
      <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
        {tr("folios.history.title")}
      </h3>
      <div className="bg-card divide-border overflow-hidden rounded-md border divide-y">
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
                  <span className="text-muted-foreground flex items-center gap-1 text-xs leading-tight">
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
                            : "folios.history.pin",
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
                            {tr("folios.history.revert")}
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
    </section>
  );
};

/**
 * Side-by-side "before / after" snapshot view. Not a token-level diff —
 * the spec calls for a "markdown-aware diff" but that's its own feature.
 * Two readable `<pre>` blocks side-by-side are enough for v1 and let the
 * user see what changed without a diff library.
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
          <SnapshotBlock revision={props.previous} />
        </div>
      )}
      <div>
        <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">
          {tr("folios.history.diff-after")}
        </div>
        <SnapshotBlock revision={props.revision} />
      </div>
    </div>
  );
};

const SnapshotBlock = (props: { revision: FolioRevision }) => (
  <pre className="bg-muted/40 max-h-72 overflow-auto whitespace-pre-wrap rounded p-2 text-[11px]">
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

export default FolioHistoryPanel;
