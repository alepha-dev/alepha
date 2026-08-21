import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
} from "react";

import type { I18n } from "../../../../services/I18n.ts";
import type { FolioFindState } from "./useFolioFind.ts";

export interface FolioFindBarProps {
  find: FolioFindState;
}

/**
 * The find-in-folio bar, floating over the top-right of the document pane.
 *
 * Deliberately NOT a dialog. A modal would cover the text it is searching,
 * and taking focus captive breaks Enter-to-advance — the one interaction
 * that makes find usable. It floats, the document stays visible behind it,
 * and Escape gives the editor its focus back.
 */
const FolioFindBar = (props: FolioFindBarProps): ReactElement | null => {
  const { tr } = useI18n<I18n, "en">();
  const inputRef = useRef<HTMLInputElement>(null);

  const open = props.find.open;

  // Autofocus and select on open: reopening the bar after a previous
  // search should let the user type over the old query without clearing it
  // first, while still keeping that query available to step through.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.find.close();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.shiftKey) props.find.previous();
    else props.find.next();
  };

  const hasQuery = props.find.query.trim().length > 0;
  const count = props.find.total
    ? tr("folios.editor.find.count", {
        args: [String(props.find.active + 1), String(props.find.total)],
      })
    : tr("folios.editor.find.none");

  return (
    <div className="border-border bg-popover absolute top-4 right-4 z-30 flex items-center gap-1 rounded-md border p-1 shadow-md">
      <Input
        ref={inputRef}
        value={props.find.query}
        onChange={(e) => props.find.setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={String(tr("folios.editor.find.placeholder"))}
        className="h-7 w-56 text-xs"
      />
      <span className="folio-mono text-muted-foreground w-20 shrink-0 text-center text-xs tabular-nums">
        {hasQuery ? count : ""}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={props.find.total === 0}
        aria-label={String(tr("folios.editor.find.previous"))}
        title={String(tr("folios.editor.find.previous"))}
        onClick={props.find.previous}
      >
        <ChevronUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={props.find.total === 0}
        aria-label={String(tr("folios.editor.find.next"))}
        title={String(tr("folios.editor.find.next"))}
        onClick={props.find.next}
      >
        <ChevronDown className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={String(tr("folios.editor.find.close"))}
        title={String(tr("folios.editor.find.close"))}
        onClick={props.find.close}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
};

export default FolioFindBar;
