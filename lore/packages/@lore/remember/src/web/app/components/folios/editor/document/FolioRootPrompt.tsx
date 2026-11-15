import { Button } from "@alepha/ui";
import { type I18n, spotlightOpenAtom } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { FilePlus, FileText, Search } from "lucide-react";

export interface FolioRootPromptProps {
  /**
   * Opens a new folio. Absent for a reader who may not write, who gets the
   * search alone.
   */
  onCreateFolio?: () => void;
}

/**
 * `/folios` with nothing chosen (#Q3655): a centred prompt to start a folio
 * or search them, in place of a listing of the root that repeated the tree
 * open beside it. A directory's own listing (`?dir=`) is unchanged.
 *
 * Search folios opens the project's search palette, the one ⌘K and the
 * header's button open, which finds folios beside quests.
 */
const FolioRootPrompt = (props: FolioRootPromptProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [, setSpotlight] = useStore(spotlightOpenAtom);

  return (
    <div
      data-testid="folio-root-prompt"
      className="flex h-full min-h-64 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <FileText className="text-muted-foreground size-8" aria-hidden />
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-base font-semibold">
          {tr("folios.editor.root.title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {tr("folios.editor.root.description")}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {props.onCreateFolio && (
          <Button
            data-testid="folio-root-new"
            onClick={() => props.onCreateFolio?.()}
          >
            <FilePlus className="size-4" />
            {tr("folios.editor.root.new")}
          </Button>
        )}
        <Button
          variant="outlined"
          data-testid="folio-root-search"
          onClick={() => setSpotlight({ open: true })}
        >
          <Search className="size-4" />
          {tr("folios.editor.root.search")}
        </Button>
      </div>
    </div>
  );
};

export default FolioRootPrompt;
