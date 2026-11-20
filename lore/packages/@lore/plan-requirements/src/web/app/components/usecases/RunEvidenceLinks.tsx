import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { RunEvidence } from "../../../../api/schemas/runEvidenceSchema.ts";

export interface RunEvidenceLinksProps {
  files: RunEvidence[];
}

/**
 * A run's files of evidence (#Q3977), each a link to the file, or its name
 * once retention removed it.
 */
const RunEvidenceLinks = (props: RunEvidenceLinksProps) => {
  const { tr } = useI18n<I18n, "en">();
  if (!props.files.length) return null;
  return (
    <ul
      className="flex flex-wrap gap-2 text-xs"
      data-testid="use-case-run-evidence"
    >
      {props.files.map((file) =>
        file.removedAt ? (
          <li key={file.fileId} className="text-muted-foreground">
            {file.name} · {tr("requirements.run.evidence.removed")}
          </li>
        ) : (
          <li key={file.fileId}>
            <a className="underline" href={`/api/files/${file.fileId}`}>
              {file.name}
            </a>
          </li>
        ),
      )}
    </ul>
  );
};

export default RunEvidenceLinks;
