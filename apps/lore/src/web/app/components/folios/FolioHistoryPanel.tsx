import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { History as HistoryIcon, Pin, PinOff, RotateCcw } from "lucide-react";
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

interface FolioHistoryPanelProps {
  folio: Folio;
  onReverted: (folio: Folio) => void;
}

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
      title: String(tr("folios.history.revert-confirm-title")),
      description: String(tr("folios.history.revert-confirm-body")),
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
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <HistoryIcon className="size-4" />
        {tr("folios.history.title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {revisions.map((revision, index) => {
          const isExpanded = expandedId === revision.id;
          // Diff against the next-older revision so the user sees what
          // *this* edit changed. The oldest entry has nothing to compare
          // against — show the snapshot alone.
          const previous = revisions[index + 1];
          return (
            <li
              key={revision.id}
              className="bg-card border-border flex flex-col gap-2 rounded-md border p-3 text-xs"
            >
              <header className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  <ActionLabel action={revision.action} />
                </Badge>
                <span className="text-muted-foreground">
                  {dt.of(revision.at).fromNow()}
                </span>
                {revision.pinned && (
                  <Badge variant="secondary" className="text-[10px]">
                    <Pin className="mr-1 size-3" />
                    {tr("folios.history.pinned-badge")}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : revision.id)
                    }
                  >
                    {isExpanded ? "−" : "+"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handlePinToggle(revision)}
                    aria-label={String(
                      tr(
                        revision.pinned
                          ? "folios.history.unpin"
                          : "folios.history.pin",
                      ),
                    )}
                  >
                    {revision.pinned ? (
                      <PinOff className="size-3.5" />
                    ) : (
                      <Pin className="size-3.5" />
                    )}
                  </Button>
                  {index > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRevert(revision.id)}
                      disabled={busy}
                    >
                      <RotateCcw className="mr-1 size-3" />
                      {tr("folios.history.revert")}
                    </Button>
                  )}
                </div>
              </header>
              {isExpanded && (
                <DiffView revision={revision} previous={previous} />
              )}
            </li>
          );
        })}
      </ul>
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
