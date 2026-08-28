import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { I18n } from "../../services/I18n.ts";

export interface KanbanColumnComposerProps {
  /**
   * Creates the quest and places it at this end of the column. Resolves
   * once the card exists; rejects to keep the typed title in the field.
   */
  onCreate: (title: string) => Promise<void>;
  /**
   * `head` composes above the first card, `foot` below the last. Only the
   * label and the icon differ; the placement is the caller's business.
   */
  position: "head" | "foot";
  disabled?: boolean;
}

/**
 * Type a title, press Enter, get a card.
 *
 * Creating a card used to mean the global button, a sheet with eight
 * fields, and a full board reload — on the one interaction a board repeats
 * most. Everything except the title takes a default and is edited from the
 * card back.
 *
 * The composer STAYS OPEN after each create, because adding cards is
 * something people do in runs of five, not one at a time. Escape closes it;
 * blur closes it only when nothing has been typed, so a mis-click does not
 * throw away a half-written title.
 */
const KanbanColumnComposer = (props: KanbanColumnComposerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus moved imperatively rather than with `autoFocus`. The attribute is
  // an a11y hazard because it steals focus whenever the element mounts,
  // including on page load; this only runs when the reader has just clicked
  // "Add a card", which is a focus move they asked for.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await props.onCreate(trimmed);
      setTitle("");
      // Deliberately keeps focus: the next card is usually next.
      inputRef.current?.focus();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={props.disabled}
        data-testid={`kanban-composer-open-${props.position}`}
        className="text-muted-foreground h-7 w-full justify-start gap-1 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        {tr("kanban.composer.add")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-1">
      <textarea
        ref={inputRef}
        rows={2}
        value={title}
        disabled={pending}
        data-testid={`kanban-composer-input-${props.position}`}
        placeholder={String(tr("kanban.composer.placeholder"))}
        className="border-border bg-card focus-visible:ring-ring w-full resize-none rounded-md border px-2 py-1.5 text-sm shadow-sm focus-visible:ring-2 focus-visible:outline-none"
        onChange={(e) => setTitle(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter is a newline, because a title
          // occasionally wants one and muscle memory expects the escape.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
      />
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={pending || !title.trim()}
          data-testid={`kanban-composer-submit-${props.position}`}
          onClick={() => void submit()}
        >
          {tr("kanban.composer.submit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setTitle("");
            setOpen(false);
          }}
        >
          {tr("common.cancel")}
        </Button>
      </div>
    </div>
  );
};

export default KanbanColumnComposer;
