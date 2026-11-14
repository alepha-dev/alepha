import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import { StackLineDiff } from "./StackLineDiff.ts";

export interface StackRevisionDiffProps {
  before: string;
  after: string;
}

/**
 * Two revisions' compose files, line by line: removed lines red, added lines
 * green, unchanged ones muted.
 */
const StackRevisionDiff = (props: StackRevisionDiffProps) => {
  const { tr } = useI18n<I18n, "en">();
  const lines = StackLineDiff.diff(props.before, props.after);
  if (!lines) {
    return (
      <p className="text-muted-foreground text-sm">
        {tr("stacks.revisions.tooLarge")}
      </p>
    );
  }
  if (lines.every((line) => line.kind === "same")) {
    return (
      <p className="text-muted-foreground text-sm">
        {tr("stacks.revisions.same")}
      </p>
    );
  }
  return (
    <pre
      className="max-h-[32rem] overflow-auto rounded border font-mono text-xs"
      data-testid="stack-revision-diff"
    >
      {lines.map((line, index) => (
        <div
          key={`${index}-${line.kind}`}
          className={
            line.kind === "add"
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : line.kind === "del"
                ? "bg-red-500/10 text-red-700 dark:text-red-400"
                : "text-muted-foreground"
          }
        >
          {`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} ${line.text}`}
        </div>
      ))}
    </pre>
  );
};

export default StackRevisionDiff;
