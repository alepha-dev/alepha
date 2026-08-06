import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioTitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The folio title, styled as document text rather than a form control — a
 * bare input with the serif face and no chrome, matching the design's "this
 * is a page, not a form" intent.
 */
const FolioTitleField = (props: FolioTitleFieldProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <input
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={String(tr("folios.title-placeholder"))}
      aria-label={String(tr("folios.editor.title-label"))}
      className="folio-prose placeholder:text-muted-foreground w-full border-0 bg-transparent p-0 text-4xl font-semibold leading-tight tracking-tight outline-none"
    />
  );
};

export default FolioTitleField;
