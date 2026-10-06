import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../services/I18n.ts";

export interface WikiLinkPreviewStateProps {
  loading: boolean;
}

/**
 * What a hover card says while it has nothing to show: loading, or, once the
 * read has failed or found nothing, unavailable. Every registered preview
 * renders it, so the cards read the same whatever kind they preview.
 */
const WikiLinkPreviewState = (props: WikiLinkPreviewStateProps) => {
  const { tr } = useI18n<I18n, "en">();

  return props.loading ? (
    <p className="text-muted-foreground text-xs">
      {tr("folios.wikilink.loading")}
    </p>
  ) : (
    <p className="text-muted-foreground text-xs italic">
      {tr("folios.wikilink.unavailable")}
    </p>
  );
};

export default WikiLinkPreviewState;
