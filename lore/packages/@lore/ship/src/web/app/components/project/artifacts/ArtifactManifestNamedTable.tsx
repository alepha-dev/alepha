import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { ArtifactManifestNamed } from "./artifactManifestParts.ts";

export interface ArtifactManifestNamedTableProps {
  rows: ArtifactManifestNamed[];
}

/**
 * The secrets or the variables a build declares: a name and what it is for.
 *
 * ⚠️ The description wraps. In the JSON it was one long line that the
 * `<pre>` pushed past the right edge, which is what the report was about:
 * the name column takes its content's width and the description the rest.
 *
 * Names only. A manifest holds no value of a secret, and neither does this.
 */
const ArtifactManifestNamedTable = (props: ArtifactManifestNamedTableProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <table className="w-full table-auto border-collapse text-sm">
      <thead>
        <tr className="text-muted-foreground text-left text-xs">
          <th className="py-1 pr-6 font-normal">
            {tr("artifact.manifest.col.name")}
          </th>
          <th className="w-full py-1 font-normal">
            {tr("artifact.manifest.col.description")}
          </th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.name} className="border-t align-top">
            <td className="py-1.5 pr-6 font-mono text-xs whitespace-nowrap">
              {row.name}
            </td>
            <td className="text-muted-foreground py-1.5 break-words whitespace-normal">
              {row.description ?? "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default ArtifactManifestNamedTable;
