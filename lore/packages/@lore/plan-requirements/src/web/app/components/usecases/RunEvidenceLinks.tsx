import { DiscussionAttachments, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { RunEvidence } from "../../../../api/schemas/runEvidenceSchema.ts";

export interface RunEvidenceLinksProps {
  files: RunEvidence[];
}

/**
 * A run's files of evidence (#Q3977): the discussion's tiles (#Q4208), so a
 * screenshot is its own thumbnail and opens larger in the lightbox, a video
 * plays there, and any other file opens in a tab. A file retention removed
 * keeps its name.
 *
 * ⚠️ Never a plain `<a href="/api/files/...">`: the router takes a
 * same-origin click without a `target` for a page and answers the 404 the
 * reporter saw. The tiles open files in a tab, which the router leaves alone.
 */
const RunEvidenceLinks = (props: RunEvidenceLinksProps) => {
  const { tr } = useI18n<I18n, "en">();
  if (!props.files.length) return null;
  const kept = props.files.filter((file) => !file.removedAt);
  const removed = props.files.filter((file) => file.removedAt);
  return (
    <div
      className="flex flex-col gap-2 text-xs"
      data-testid="use-case-run-evidence"
    >
      <DiscussionAttachments
        items={kept.map((file) => ({
          id: file.fileId,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
        }))}
      />
      {removed.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {removed.map((file) => (
            <li key={file.fileId} className="text-muted-foreground">
              {file.name} · {tr("requirements.run.evidence.removed")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RunEvidenceLinks;
