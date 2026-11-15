import { Segmented } from "@alepha/ui";
import type { I18n, MarkdownEditorMode } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Columns2, Eye, Pencil } from "lucide-react";

export interface FolioModeToolbarProps {
  mode: MarkdownEditorMode;
  onChange: (mode: MarkdownEditorMode) => void;
  disabled?: boolean;
}

/**
 * The folio document's toolbar row (#Q3653): Edit, View and Both as one
 * segmented control, where a lone pencil used to float over the page. Each
 * mode is an icon (#Q3692), a pencil, an eye and two columns, named and
 * tooltipped by its old label, the active one on the control's thumb.
 *
 * `data-testid="folio-mode"` and `data-mode` are the e2e's handle, as
 * `markdown-mode-toggle` was: CodeMirror is not mounted in View, so a spec
 * that types has to read the mode before it picks Edit.
 */
const FolioModeToolbar = (props: FolioModeToolbarProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div
      data-slot="folio-mode-toolbar"
      className="border-border flex h-11 shrink-0 items-center justify-end border-b px-3"
    >
      <span data-testid="folio-mode" data-mode={props.mode}>
        <Segmented
          size="sm"
          value={props.mode}
          disabled={props.disabled}
          aria-label={tr("folios.mode.label")}
          onChange={(value) => props.onChange(value as MarkdownEditorMode)}
          options={[
            {
              value: "edit",
              label: <Pencil className="size-3.5" />,
              title: tr("folios.mode.edit"),
            },
            {
              value: "view",
              label: <Eye className="size-3.5" />,
              title: tr("folios.mode.view"),
            },
            {
              value: "both",
              label: <Columns2 className="size-3.5" />,
              title: tr("folios.mode.both"),
            },
          ]}
        />
      </span>
    </div>
  );
};

export default FolioModeToolbar;
