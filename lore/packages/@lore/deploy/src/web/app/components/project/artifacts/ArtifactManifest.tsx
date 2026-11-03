import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";

export interface ArtifactManifestProps {
  variant: ArtifactResource;
}

/**
 * The build's own document, verbatim. Overview reads the parts it understands;
 * this is what a newer build declares that this Lore has never heard of.
 *
 * Rendered as text inside `<pre>`, never as markup. It names secrets and holds
 * no value of one.
 */
const ArtifactManifest = (props: ArtifactManifestProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { manifest } = props.variant;

  return (
    <div data-testid="artifact-manifest" className="p-4">
      {manifest ? (
        <pre className="bg-muted/40 overflow-x-auto rounded-md border p-4 font-mono text-xs">
          {JSON.stringify(manifest, null, 2)}
        </pre>
      ) : (
        <p className="text-muted-foreground text-sm">
          {tr("artifact.needs.unknown")}
        </p>
      )}
    </div>
  );
};

export default ArtifactManifest;
