import {
  Checkbox,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";
import FolioTableCellEditor from "./FolioTableCellEditor.tsx";
import { folioCellEditText, folioCellText } from "./folioTableModel.ts";

export interface FolioTableRowSheetProps {
  columns: FolioColumnResource[];
  /**
   * What a reference field offers, from the `[[#` picker.
   */
  referenceSuggestions?: Array<{ token: string; label: string }>;
  /**
   * The row open, or nothing (the sheet is closed).
   */
  row?: FolioRowResource;
  readOnly: boolean;
  onClose: () => void;
  onWriteCell: (row: FolioRowResource, columnId: string, text: string) => void;
}

/**
 * One row, every cell editable, in a side sheet (#Q3518): what opens when an
 * entry of the calendar is clicked. The same editors as the grid, one per
 * column, each writing its cell with the row's version as it changes.
 */
const FolioTableRowSheet = (props: FolioTableRowSheetProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const row = props.row;

  return (
    <Sheet
      open={row !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetContent side="right" className="w-[min(92vw,28rem)]">
        <SheetHeader>
          <SheetTitle>
            {row
              ? tr("folios.table.row.menu", { args: [String(row.number)] })
              : ""}
          </SheetTitle>
        </SheetHeader>
        {row && (
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">
            {props.columns.map((column) => {
              const value = row.cells[column.id] ?? null;
              return (
                <div
                  key={`${row.id}:${row.version}:${column.id}`}
                  className="flex flex-col gap-1"
                >
                  <span className="text-muted-foreground text-xs font-medium">
                    {column.name}
                  </span>
                  {props.readOnly ? (
                    <span className="text-sm">
                      {column.type === "checkbox"
                        ? value === true
                          ? "✓"
                          : ""
                        : folioCellText(column, value)}
                    </span>
                  ) : column.type === "checkbox" ? (
                    <Checkbox
                      checked={value === true}
                      aria-label={column.name}
                      onCheckedChange={() =>
                        props.onWriteCell(
                          row,
                          column.id,
                          value === true ? "false" : "true",
                        )
                      }
                    />
                  ) : (
                    <FolioTableCellEditor
                      column={column}
                      initial={folioCellEditText(column, value)}
                      autoFocus={false}
                      persistent
                      framed
                      referenceSuggestions={props.referenceSuggestions}
                      onCommit={(text) => {
                        if (text !== folioCellEditText(column, value)) {
                          props.onWriteCell(row, column.id, text);
                        }
                      }}
                      onCancel={() => {}}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default FolioTableRowSheet;
