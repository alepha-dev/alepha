import { Button } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

import type { codeDiffFileSchema } from "../../../../../api/schemas/codeDiffFileSchema.ts";
import type { codeDiffSchema } from "../../../../../api/schemas/codeDiffSchema.ts";
import CodeDiffFileView from "./CodeDiffFileView.tsx";

export interface CodeDiffProps {
  diff: Infer<typeof codeDiffSchema>;
  projectId: number;
  repoSlug: string;
  /**
   * The revisions a file's hunks are loaded between, as the server was
   * asked for this diff.
   */
  from?: string;
  to: string;
  onPage?: (page: number) => void;
  /**
   * Drawn under a line, by its `path:side:line` anchor: a pull request's
   * comment thread (#E169). Unused by the code browser.
   */
  renderLineAfter?: (anchor: string) => ReactNode;
  /**
   * Drawn at the end of a file's header.
   */
  renderFileHeaderActions?: (
    file: Infer<typeof codeDiffFileSchema>,
  ) => ReactNode;
}

/**
 * A unified diff (#Q4135), the one the commit page, compare and a pull
 * request (#E169) all draw: the changed files with their counts, then each
 * file. No split view in v1.
 */
const CodeDiff = (props: CodeDiffProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { diff } = props;
  const pages = Math.ceil(diff.total / diff.pageSize);
  return (
    <div className="flex flex-col gap-3" data-testid="code-diff">
      <p className="text-muted-foreground text-sm">
        {tr("code.diff.files", { args: [String(diff.total)] })}
        {diff.partial && ` ${tr("code.diff.partial")}`}
      </p>
      <ul
        className="flex flex-col gap-0.5 text-xs"
        data-testid="code-diff-list"
      >
        {diff.files.map((file) => (
          <li key={file.path} className="flex items-center gap-2 font-mono">
            <a href={`#diff-${file.path}`} className="truncate hover:underline">
              {file.path}
            </a>
            {file.additions !== undefined && (
              <span>
                <span className="text-green-600 dark:text-green-400">
                  +{file.additions}
                </span>{" "}
                <span className="text-red-600 dark:text-red-400">
                  -{file.deletions}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {diff.files.map((file) => (
        <CodeDiffFileView
          key={`${diff.to}:${file.path}`}
          file={file}
          projectId={props.projectId}
          repoSlug={props.repoSlug}
          from={props.from}
          to={props.to}
          renderLineAfter={props.renderLineAfter}
          renderFileHeaderActions={props.renderFileHeaderActions}
        />
      ))}
      {pages > 1 && props.onPage && (
        <div className="flex items-center gap-2">
          <Button
            variant="outlined"
            size="sm"
            disabled={diff.page === 0}
            onClick={() => props.onPage?.(diff.page - 1)}
          >
            {tr("code.diff.previous")}
          </Button>
          <span className="text-muted-foreground text-xs">
            {tr("code.diff.page", {
              args: [String(diff.page + 1), String(pages)],
            })}
          </span>
          <Button
            variant="outlined"
            size="sm"
            disabled={diff.page + 1 >= pages}
            onClick={() => props.onPage?.(diff.page + 1)}
          >
            {tr("code.diff.next")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default CodeDiff;
