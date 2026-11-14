import { Segmented } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactManifestSections from "./ArtifactManifestSections.tsx";

export interface ArtifactManifestProps {
  variant: ArtifactResource;
}

/**
 * The build's own document: drawn, with the verbatim JSON one click away.
 *
 * It was the JSON alone, on the reasoning that Overview reads the parts it
 * understands and this tab is what a newer build declares that this Lore has
 * never heard of. Both halves still hold: `ArtifactManifestSections` draws
 * what is known and prints the rest raw under Other, and the Raw view is the
 * old `<pre>`, unchanged.
 *
 * ⚠️ Only an archive's `dist/manifest.json` is drawn. An image's `manifest`
 * is its OCI index, another document altogether (see `ArtifactNeeds`), and
 * it stays raw with no toggle.
 *
 * Rendered as text, never as markup. It names secrets and holds no value of
 * one.
 */
const ArtifactManifest = (props: ArtifactManifestProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { manifest, format } = props.variant;
  const [view, setView] = useState<"structured" | "raw">("structured");
  const drawable = !!manifest && format !== "image";

  return (
    <div data-testid="artifact-manifest" className="flex flex-col gap-4 p-4">
      {drawable && (
        <Segmented
          size="sm"
          className="self-start"
          value={view}
          onChange={(value) => setView(value === "raw" ? "raw" : "structured")}
          options={[
            {
              value: "structured",
              label: tr("artifact.manifest.view.structured"),
            },
            { value: "raw", label: tr("artifact.manifest.view.raw") },
          ]}
        />
      )}

      {!manifest ? (
        <p className="text-muted-foreground text-sm">
          {tr("artifact.needs.unknown")}
        </p>
      ) : drawable && view === "structured" ? (
        <ArtifactManifestSections manifest={manifest} />
      ) : (
        <pre
          data-testid="artifact-manifest-raw"
          className="bg-muted/40 overflow-x-auto rounded-md border p-4 font-mono text-xs"
        >
          {JSON.stringify(manifest, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default ArtifactManifest;
