import { cn } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import { RunNote } from "../../services/RunNote.ts";

export interface RunResultNoteProps {
  note: string;
  /**
   * The criterion failed: the rows get the danger rule on their side.
   */
  failed?: boolean;
}

// Spelled out, so the i18n check finds every key it reads.
const LABEL_KEYS = {
  expected: "requirements.run.evidence.expected",
  seen: "requirements.run.evidence.seen",
  also: "requirements.run.evidence.also",
} as const;

/**
 * A criterion's evidence (#Q4210). In the shape the agent guidance asks for,
 * it reads for a human first: Expected, Seen and Also as labelled rows, then
 * the developer's details (page, state, repro, ids) folded under them. Any
 * other note is the Markdown it always was.
 */
const RunResultNote = (props: RunResultNoteProps) => {
  const { tr } = useI18n<I18n, "en">();
  const shape = RunNote.parse(props.note);

  if (!shape) {
    return (
      <div className="text-muted-foreground text-xs" data-testid="run-evidence">
        <MarkdownView content={props.note} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs" data-testid="run-evidence">
      {shape.intro ? (
        <div className="text-muted-foreground">
          <MarkdownView content={shape.intro} />
        </div>
      ) : null}
      {shape.rows.length ? (
        <dl
          className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border-s-2 py-2 ps-3 pe-2",
            props.failed ? "border-danger bg-danger/5" : "border-border",
          )}
          data-testid="run-evidence-rows"
        >
          {shape.rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="contents">
              <dt
                className="text-muted-foreground pt-px text-[11px] font-semibold tracking-wide uppercase"
                data-label={row.label}
              >
                {tr(LABEL_KEYS[row.label])}
              </dt>
              <dd className="min-w-0">
                <MarkdownView content={row.text} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {shape.details ? (
        <details data-testid="run-evidence-details">
          <summary className="text-primary cursor-pointer select-none">
            {tr("requirements.run.evidence.details")}
          </summary>
          <div className="chrome text-muted-foreground mt-1 rounded-md border p-2">
            <MarkdownView content={shape.details} />
          </div>
        </details>
      ) : null}
    </div>
  );
};

export default RunResultNote;
