import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { FilePlus, FileText } from "lucide-react";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioEmptyStateProps {
  onCreate: () => void;
}

/**
 * What the document pane shows at `/folios`, with the tree open beside it
 * and nothing chosen yet — the editor's equivalent of an IDE with no file
 * open.
 *
 * Deliberately quiet: one line saying where to go and one button for the
 * case where there is nothing in the tree to go to. The panes around it
 * are the actual navigation, so this should not compete with them.
 */
const FolioEmptyState = (props: FolioEmptyStateProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <FileText className="text-muted-foreground/40 size-10" />
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">
          {tr("folios.editor.empty.title")}
        </p>
        <p className="text-muted-foreground/70 text-xs">
          {tr("folios.editor.empty.hint")}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={props.onCreate}>
        <FilePlus className="size-4" />
        {tr("folios.editor.tree.new-folio")}
      </Button>
    </div>
  );
};

export default FolioEmptyState;
