import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Waypoints } from "lucide-react";
import { lazy, Suspense, useState } from "react";

const FolioGraph = lazy(() => import("./FolioGraph.tsx"));

export interface FolioGraphButtonProps {
  /**
   * The folio being read, highlighted in the graph.
   */
  currentFolioId?: string;
}

/**
 * The button at the right of the folio menubar (#Q4262) that opens the
 * project's folio graph in a dialog.
 */
const FolioGraphButton = (props: FolioGraphButtonProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [open, setOpen] = useState(false);
  const label = tr("folios.graph.open");

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="minimal"
              size="icon-xs"
              aria-label={label}
              data-testid="folio-graph-button"
              onClick={() => setOpen(true)}
            >
              <Waypoints className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[calc(100dvh-4rem)] max-w-[calc(100vw-4rem)] flex-col gap-2 sm:max-w-[calc(100vw-4rem)]">
          <DialogHeader>
            <DialogTitle>{tr("folios.graph.title")}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {open && (
              <Suspense fallback={null}>
                <FolioGraph
                  currentFolioId={props.currentFolioId}
                  onOpened={() => setOpen(false)}
                />
              </Suspense>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default FolioGraphButton;
