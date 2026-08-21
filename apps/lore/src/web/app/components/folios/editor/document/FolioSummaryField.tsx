import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { Sparkles } from "lucide-react";
import type { ReactElement } from "react";

import type { I18n } from "../../../../services/I18n.ts";

export interface FolioSummaryFieldProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Protected folios keep no searchable summary — the server blanks
   * `searchText` for them — but the `summary` column itself is NOT blanked
   * or otherwise restricted server-side (`FolioController.update` writes it
   * unconditionally). Read-only here is a client-side privacy choice: a
   * plaintext summary is visible to every project member via `folio_list` /
   * `project_context` regardless of who can decrypt the body, so editing it
   * while the folio is protected would be an easy way to leak a hint about
   * content the user chose to encrypt. Set whenever the folio is protected,
   * independent of whether it happens to be unlocked this session — the
   * summary's visibility to OTHER members doesn't change with that.
   */
  unavailable?: boolean;
}

const MAX_LENGTH = 500;

/**
 * The agent-readable summary. This is the first web surface that writes
 * `folios.summary`: the column has existed since the MCP tools started
 * setting it, and `project_context` reads it to build the folio index, but
 * until now only an agent could fill it in.
 */
const FolioSummaryField = (props: FolioSummaryFieldProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="border-border hover:border-muted-foreground/40 mt-4 flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors">
      <Sparkles className="text-muted-foreground mt-0.5 size-3.5 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="folio-mono text-muted-foreground text-[10.5px] font-medium uppercase tracking-[0.1em]">
            {tr("folios.editor.summary.label")}
          </span>
          {/* Only the unavailable case earns a note. "Click to edit" on a
              textbox tells the reader what a textbox is. */}
          {props.unavailable && (
            <span className="text-muted-foreground/70 text-[11px]">
              {tr("folios.editor.summary.unavailable")}
            </span>
          )}
        </div>
        <textarea
          value={props.value}
          readOnly={props.unavailable}
          maxLength={MAX_LENGTH}
          rows={2}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={String(tr("folios.editor.summary.placeholder"))}
          aria-label={String(tr("folios.editor.summary.label"))}
          className={cn(
            "focus:bg-muted mt-0.5 w-full resize-none border-0 bg-transparent px-1 py-0.5 text-sm leading-relaxed outline-none",
            props.unavailable && "text-muted-foreground",
          )}
        />
      </div>
    </div>
  );
};

export default FolioSummaryField;
