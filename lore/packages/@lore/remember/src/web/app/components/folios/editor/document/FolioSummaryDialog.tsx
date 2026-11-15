import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useState } from "react";

import FolioSummaryField from "./FolioSummaryField.tsx";

export interface FolioSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The summary as the draft holds it.
   */
  value: string;
  /**
   * Read only: a protected folio, whose summary the server does not take.
   */
  unavailable?: boolean;
  onSave: (summary: string) => void;
}

/**
 * Folio ▸ Edit summary… (#Q3704): the folio's one or two sentences for
 * agents, read and edited in a dialog in every project, where an option
 * used to reveal a field above the body. Saving writes the draft's summary,
 * which the folio's auto-save persists: the same field MCP writes.
 */
const FolioSummaryDialog = (props: FolioSummaryDialogProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [text, setText] = useState(props.value);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("folios.summary.title")}</DialogTitle>
          <DialogDescription>
            {tr("folios.summary.description")}
          </DialogDescription>
        </DialogHeader>
        <FolioSummaryField
          value={text}
          onChange={setText}
          unavailable={props.unavailable}
        />
        <DialogFooter>
          <Button variant="outlined" onClick={() => props.onOpenChange(false)}>
            {tr("common.cancel")}
          </Button>
          <Button
            disabled={props.unavailable || text === props.value}
            onClick={() => {
              props.onSave(text.trim());
              props.onOpenChange(false);
            }}
          >
            {tr("folios.summary.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FolioSummaryDialog;
