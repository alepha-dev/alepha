import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Folder } from "lucide-react";
import { type ReactElement, useState } from "react";

import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioMoveDialogProps {
  open: boolean;
  folioTitle: string;
  /**
   * The folio's current directory, so the picker can highlight where it
   * already lives. `undefined` means project root.
   */
  currentDirectoryId?: string;
  onCancel: () => void;
  /**
   * `null` for the project root, never `undefined` — the controller reads
   * `"directoryId" in body"` to distinguish "move to root" from "leave
   * unchanged": `undefined` is dropped by the ORM update layer and leaves
   * the folio where it was, while `null` writes SQL `NULL`. This asymmetry
   * cost a real bug already (see `FolioController.update`'s comment).
   */
  onConfirm: (directoryId: string | null) => void | Promise<void>;
}

/**
 * Directory picker for the document workspace's "Move to…" action. Lists
 * `projectDirectoriesAtom` flat (already flat from `listAllDirectories`,
 * pre-fetched by the folio route loader) with a "Project root" entry at the
 * top. Unlike `FolioBrowser`'s own `MoveDialog` (which also moves
 * directories and blobs, and must therefore exclude a directory's own
 * descendants to avoid creating a cycle), a folio is always a leaf — no
 * cycle is possible, so every directory in the project is a valid target.
 */
const FolioMoveDialog = (props: FolioMoveDialogProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [directories] = useStore(projectDirectoriesAtom);
  const [picked, setPicked] = useState<string | undefined>(undefined);

  const handleConfirm = async () => {
    if (picked === undefined) return;
    await props.onConfirm(picked === "__root__" ? null : picked);
    setPicked(undefined);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setPicked(undefined);
      props.onCancel();
    }
  };

  const selectedId = picked ?? props.currentDirectoryId ?? "__root__";

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("folio.move.title", { args: [props.folioTitle] })}
          </DialogTitle>
          <DialogDescription>{tr("folio.move.helper")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-auto rounded-md border">
          <button
            type="button"
            onClick={() => setPicked("__root__")}
            className={`hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              selectedId === "__root__" ? "bg-muted" : ""
            }`}
          >
            <Folder className="text-muted-foreground size-4" />
            {tr("folio.move.root")}
          </button>
          {directories.length === 0 && (
            <div className="text-muted-foreground px-3 py-2 text-xs italic">
              {tr("folio.move.empty")}
            </div>
          )}
          {directories.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setPicked(d.id)}
              className={`hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                selectedId === d.id ? "bg-muted" : ""
              }`}
            >
              <Folder className="text-primary size-4" />
              {d.name}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onCancel}>
            {tr("folio.move.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={picked === undefined}>
            {tr("folio.move.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FolioMoveDialog;
