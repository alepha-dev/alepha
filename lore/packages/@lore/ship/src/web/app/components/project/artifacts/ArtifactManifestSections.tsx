import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import ArtifactManifestNamedTable from "./ArtifactManifestNamedTable.tsx";
import { artifactManifestParts } from "./artifactManifestParts.ts";
import ArtifactManifestSection from "./ArtifactManifestSection.tsx";
import { cronReading } from "./cronReading.ts";

export interface ArtifactManifestSectionsProps {
  /**
   * An archive's `dist/manifest.json`. An image's OCI index is not this
   * document and is shown raw by the caller.
   */
  manifest: Record<string, any>;
}

/**
 * The manifest drawn: one section per thing a build declares, and a last
 * one, Other, for whatever this Lore does not know how to draw.
 *
 * The format is ours (`buildManifestSchema` in `alepha/cli`), which is why
 * it can be drawn at all; it is also `.loose()` and written by builds of any
 * age, which is why `artifactManifestParts` returns the leftovers and this
 * prints them. A section with nothing in it is left out.
 *
 * Text only, never markup: every value is a React text node.
 */
const ArtifactManifestSections = (props: ArtifactManifestSectionsProps) => {
  const { tr, lang } = useI18n<I18n, "en">();
  const parts = artifactManifestParts(props.manifest);

  const reading = (expression: string): string | undefined => {
    const read = cronReading(expression);
    if (!read) return undefined;
    if (read.weekday === undefined) {
      return tr(read.key, { args: read.args });
    }
    // 2023-01-01 was a Sunday: the day's name, in the reader's language.
    const day = new Intl.DateTimeFormat(lang, {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2023, 0, 1 + read.weekday)));
    return tr(read.key, { args: [day, ...read.args] });
  };

  const raw = (value: unknown) => (
    <pre className="bg-muted/40 overflow-x-auto rounded-md border p-3 font-mono text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {parts.build.length > 0 && (
        <ArtifactManifestSection
          name="build"
          title={tr("artifact.manifest.section.build")}
        >
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
            {parts.build.map((row) => (
              <div key={row.name} className="contents">
                <dt className="text-muted-foreground">{row.name}</dt>
                <dd className="font-mono text-xs break-all">{row.value}</dd>
              </div>
            ))}
          </dl>
        </ArtifactManifestSection>
      )}

      {parts.runtimes.length > 0 && (
        <ArtifactManifestSection
          name="runtimes"
          title={tr("artifact.needs.slices")}
        >
          <table className="w-full table-auto border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-1 pr-6 font-normal">
                  {tr("artifact.manifest.col.runtime")}
                </th>
                <th className="py-1 pr-6 font-normal">
                  {tr("artifact.manifest.col.entry")}
                </th>
                <th className="py-1 font-normal">
                  {tr("artifact.manifest.col.version")}
                </th>
              </tr>
            </thead>
            <tbody>
              {parts.runtimes.map((slice) => (
                <tr key={slice.runtime} className="border-t">
                  <td className="py-1.5 pr-6">{slice.runtime}</td>
                  <td className="py-1.5 pr-6 font-mono text-xs">
                    {slice.entry ?? "-"}
                  </td>
                  <td className="py-1.5 font-mono text-xs">
                    {slice.version ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ArtifactManifestSection>
      )}

      {parts.resources.length > 0 && (
        <ArtifactManifestSection
          name="resources"
          title={tr("artifact.needs.resources")}
        >
          {/* On or off as a mark, the way `ArtifactNeeds` draws them: eight
              `true` / `false` lines say less than one row of badges. The
              state is in the label too, never in the colour alone. */}
          <div className="flex flex-wrap gap-1.5">
            {parts.resources.map((it) => (
              <Badge
                key={it.name}
                variant={it.on ? "secondary" : "outline"}
                className={it.on ? undefined : "text-muted-foreground"}
                aria-label={`${it.name}: ${tr(
                  it.on ? "artifact.manifest.on" : "artifact.manifest.off",
                )}`}
              >
                {it.name}
              </Badge>
            ))}
          </div>
        </ArtifactManifestSection>
      )}

      {parts.crons.length > 0 && (
        <ArtifactManifestSection
          name="crons"
          title={tr("artifact.needs.crons")}
        >
          <ul className="flex flex-col gap-1 text-sm">
            {parts.crons.map((expression, index) => (
              // The same expression may be declared twice.
              <li key={`${expression}-${index}`} className="flex gap-4">
                <code className="min-w-28 font-mono text-xs">{expression}</code>
                <span className="text-muted-foreground">
                  {reading(expression) ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </ArtifactManifestSection>
      )}

      {parts.secrets.length > 0 && (
        <ArtifactManifestSection
          name="secrets"
          title={tr("artifact.needs.secrets")}
        >
          <ArtifactManifestNamedTable rows={parts.secrets} />
        </ArtifactManifestSection>
      )}

      {parts.variables.length > 0 && (
        <ArtifactManifestSection
          name="variables"
          title={tr("artifact.needs.variables")}
        >
          <ArtifactManifestNamedTable rows={parts.variables} />
        </ArtifactManifestSection>
      )}

      {(parts.websocketPaths.length > 0 || parts.cloudflare) && (
        <ArtifactManifestSection name="cloudflare" title="Cloudflare">
          {parts.websocketPaths.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">
                {tr("artifact.needs.websockets")}:{" "}
              </span>
              <code className="font-mono text-xs">
                {parts.websocketPaths.join(", ")}
              </code>
            </p>
          )}
          {parts.cloudflare && raw(parts.cloudflare)}
        </ArtifactManifestSection>
      )}

      {parts.other && (
        <ArtifactManifestSection
          name="other"
          title={tr("artifact.manifest.section.other")}
        >
          <p className="text-muted-foreground text-xs">
            {tr("artifact.manifest.other.hint")}
          </p>
          {raw(parts.other)}
        </ArtifactManifestSection>
      )}
    </div>
  );
};

export default ArtifactManifestSections;
