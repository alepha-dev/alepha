import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useState } from "react";

import FolioTableGrid from "./FolioTableGrid.tsx";
import { folioDecodeTableSnapshot } from "./folioTableModel.ts";

export interface FolioTableRevisionViewProps {
  /**
   * The revision's `contentSnapshot`: the table as JSON (#Q3513).
   */
  snapshot: string;
  title: string;
}

/**
 * A table revision, read-only (#Q3516): a button in the History tab that
 * opens the revision's columns and rows as a grid in a side sheet. A
 * snapshot that does not decode says so and shows nothing else. Revert
 * stays where it is, in the revision's menu.
 */
const FolioTableRevisionView = (
  props: FolioTableRevisionViewProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [open, setOpen] = useState(false);
  const decoded = folioDecodeTableSnapshot(props.snapshot);

  if (!decoded) {
    return (
      <p className="text-muted-foreground text-xs">
        {tr("folios.table.history.unreadable")}
      </p>
    );
  }

  return (
    <>
      <Button variant="outlined" size="sm" onClick={() => setOpen(true)}>
        {tr("folios.table.history.view")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[min(90vw,64rem)] max-w-none">
          <SheetHeader>
            <SheetTitle>{props.title}</SheetTitle>
          </SheetHeader>
          <div className="overflow-auto px-4 pb-4">
            <FolioTableGrid
              columns={decoded.columns}
              rows={decoded.rows}
              readOnly
              conflicts={[]}
              renderHeader={(column) => (
                <span className="truncate px-2 font-medium">{column.name}</span>
              )}
              onWriteCell={() => {}}
              onPaste={() => {}}
              onClear={() => {}}
              onInsertBelow={() => {}}
              onDeleteRows={() => {}}
              onMoveRow={() => {}}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default FolioTableRevisionView;
