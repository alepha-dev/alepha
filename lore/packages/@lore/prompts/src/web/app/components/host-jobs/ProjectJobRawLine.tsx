import { Button } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

export interface ProjectJobRawLineProps {
  line: string;
}

/**
 * A log line the transcript could not read, in monospace. A long one is cut
 * at 500 characters with a button for the rest
 * (#Q4323): a line of base64 printed whole filled the page.
 */
const ProjectJobRawLine = (props: ProjectJobRawLineProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [open, setOpen] = useState(false);
  // How much of a raw line shows before the button.
  const limit = 500;
  const long = props.line.length > limit;
  return (
    <div className="flex flex-col items-start gap-1">
      <pre
        className="text-muted-foreground max-w-full font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap"
        data-testid="job-raw-line"
      >
        {long && !open ? `${props.line.slice(0, limit)}…` : props.line}
      </pre>
      {long && (
        <Button
          variant="minimal"
          size="sm"
          onClick={() => setOpen((it) => !it)}
        >
          {open
            ? tr("jobs.transcript.rawLess")
            : tr("jobs.transcript.rawMore", {
                args: [String(props.line.length - limit)],
              })}
        </Button>
      )}
    </div>
  );
};

export default ProjectJobRawLine;
