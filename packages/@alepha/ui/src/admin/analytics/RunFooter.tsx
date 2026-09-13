import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Braces, ChevronUp, Play, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";

import { useDismissable } from "./useDismissable.ts";

export interface RunFooterProps {
  running: boolean;
  onRun: () => void;
  onRequest: () => void;
  onReset: () => void;
}

/**
 * The panel's fixed footer: a split button, outside the clause scroller so it
 * never moves.
 *
 * `Run query` re-runs on demand. The panel already re-runs itself whenever the
 * query changes, so this is a refresh rather than the only way to see a
 * result: a design where "Raise to 200" and a column sort both leave the
 * numbers stale until someone presses a button is a design that lies for as
 * long as nobody presses it.
 */
export const RunFooter = (props: RunFooterProps) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismissable({ open, onClose: close, selector: "[data-run-menu]" });

  return (
    <div
      data-run-menu
      className="border-border bg-card relative flex flex-none gap-0.5 border-t px-4 pt-3 pb-3.5"
    >
      <Button
        type="button"
        size="lg"
        loading={props.running}
        onClick={props.onRun}
        className="h-9 flex-1 rounded-r-none text-[13.5px]"
      >
        <Play className="size-3.5" />
        {tr("admin.analytics.run", { default: "Run query" })}
      </Button>
      <Button
        type="button"
        size="lg"
        aria-haspopup="menu"
        aria-expanded={open}
        title={tr("admin.analytics.more", { default: "More" })}
        onClick={() => setOpen((current) => !current)}
        className="size-9 rounded-l-none p-0"
      >
        <ChevronUp className="size-3.5" />
      </Button>
      {open && (
        <div
          role="menu"
          className="bg-popover ring-border absolute right-4 bottom-14 z-40 w-[186px] rounded-lg p-1.5 shadow-lg ring-1 ring-inset"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              props.onRequest();
            }}
            className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <Braces className="text-muted-foreground size-3.5" />
            {tr("admin.analytics.requestItem", { default: "Request…" })}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              props.onReset();
            }}
            className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <RotateCcw className="text-muted-foreground size-3.5" />
            {tr("admin.analytics.resetItem", { default: "Reset query" })}
          </button>
        </div>
      )}
    </div>
  );
};
