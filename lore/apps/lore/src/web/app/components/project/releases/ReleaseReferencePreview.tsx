import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import type { WikiLinkPreviewProps } from "../../../registries/ElementReferenceRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import { formatReference } from "../../shared/element/typedReference.ts";
import WikiLinkPreviewState from "../../shared/element/WikiLinkPreviewState.tsx";

/**
 * A release's hover card: its reference, title, tag and whether it has
 * shipped. A release link carries its TAG, which is what the route takes, so
 * the preview is a lookup by tag in the project layout's atom, never a fetch.
 */
const ReleaseReferencePreview = (props: WikiLinkPreviewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [releases] = useStore(currentReleasesAtom);
  const release = (releases ?? []).find((r) => r.tag === props.id);

  if (!release) return <WikiLinkPreviewState loading={false} />;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("release", release.number)}
        </span>
        <span className="text-sm font-semibold">{release.title}</span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        {release.tag && <span>{release.tag}</span>}
        <span>
          {release.tag ? "· " : ""}
          {tr(
            release.releasedAt != null
              ? "folios.wikilink.release.released"
              : "folios.wikilink.release.open",
          )}
        </span>
      </div>
    </div>
  );
};

export default ReleaseReferencePreview;
