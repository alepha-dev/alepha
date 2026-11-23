import { Badge, Button } from "@alepha/ui";
import { highlightLanguageOf } from "@alepha/ui/markdown";
import type { I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, ChevronRight, UnfoldVertical } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import type { CodeBrowserController } from "../../../../../api/controllers/CodeBrowserController.ts";
import type { codeDiffFileSchema } from "../../../../../api/schemas/codeDiffFileSchema.ts";
import { gapBefore, highlightHunk } from "./codeDiffView.ts";

type DiffFile = Infer<typeof codeDiffFileSchema>;

export interface CodeDiffFileViewProps {
  file: DiffFile;
  projectId: number;
  repoSlug: string;
  from?: string;
  to: string;
  renderLineAfter?: (anchor: string) => ReactNode;
  renderFileHeaderActions?: (file: DiffFile) => ReactNode;
}

/**
 * One file of a unified diff (#Q4135): its header (the change, `+N -M`),
 * then its hunks highlighted, "show more" between them for the context the
 * diff hid, and a file whose hunks are not loaded (a generated one, one
 * past the eager budget) loaded when opened. The two slots are for #E169:
 * a comment thread under a line, actions on the header.
 */
const CodeDiffFileView = (props: CodeDiffFileViewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<CodeBrowserController>();
  const initial = props.file;
  const [open, setOpen] = useState(initial.status !== "collapsed");
  const [gaps, setGaps] = useState<Record<number, string[]>>({});
  const needsLoad =
    open && (initial.status === "pending" || initial.status === "collapsed");
  const { data: loaded, loading } = useQuery(
    {
      enabled: needsLoad,
      key: [
        "code-diff-file",
        props.projectId,
        props.repoSlug,
        props.from,
        props.to,
        initial.path,
      ],
      handler: async () =>
        api.getCodeDiffFile({
          params: { projectId: props.projectId, slug: props.repoSlug },
          query: { from: props.from, to: props.to, path: initial.path },
        }),
    },
    [needsLoad, initial.path, props.from, props.to],
  );
  const file = loaded ?? initial;
  const language = highlightLanguageOf(file.path);
  const hunks = file.hunks ?? [];

  const expand = async (index: number, start: number, end: number) => {
    if (!file.newSha) return;
    const { lines } = await api.getCodeBlobLines({
      params: {
        projectId: props.projectId,
        slug: props.repoSlug,
        sha: file.newSha,
      },
      query: { start, end },
    });
    setGaps((current) => ({ ...current, [index]: lines }));
  };

  const row = (
    key: string,
    kind: "context" | "add" | "del",
    oldLine: number | undefined,
    newLine: number | undefined,
    tokens: ReactNode,
    anchor?: string,
  ) => (
    <Fragment key={key}>
      <tr
        data-kind={kind}
        id={anchor ? `diff-${anchor}` : undefined}
        className={
          kind === "add"
            ? "bg-green-500/10"
            : kind === "del"
              ? "bg-red-500/10"
              : undefined
        }
      >
        <td className="text-muted-foreground w-1 px-2 text-right select-none">
          {oldLine}
        </td>
        <td className="text-muted-foreground w-1 px-2 text-right select-none">
          {newLine}
        </td>
        <td className="w-1 pl-1 select-none">
          {kind === "add" ? "+" : kind === "del" ? "-" : " "}
        </td>
        <td className="pr-4 whitespace-pre">{tokens}</td>
      </tr>
      {anchor && props.renderLineAfter?.(anchor) ? (
        <tr>
          <td colSpan={4}>{props.renderLineAfter(anchor)}</td>
        </tr>
      ) : null}
    </Fragment>
  );

  const gap = (index: number) => {
    const range = gapBefore(hunks, index, file.newLineCount);
    if (!range) return null;
    const lines = gaps[index];
    if (lines) {
      return lines.map((text, at) =>
        row(
          `g${index}-${at}`,
          "context",
          range.start + at - range.delta,
          range.start + at,
          text,
        ),
      );
    }
    if (!file.newSha) return null;
    return (
      <tr key={`gap${index}`}>
        <td colSpan={4} className="bg-hover-weak px-2 py-0.5">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            onClick={() => void expand(index, range.start, range.end)}
          >
            <UnfoldVertical className="size-3.5" />
            {tr("code.diff.more", {
              args: [String(range.end - range.start + 1)],
            })}
          </button>
        </td>
      </tr>
    );
  };

  const kindLabel: Record<DiffFile["kind"], string> = {
    added: tr("code.diff.added"),
    modified: tr("code.diff.modified"),
    deleted: tr("code.diff.deleted"),
    renamed: tr("code.diff.renamed"),
  };

  return (
    <section
      className="overflow-hidden rounded-md border"
      id={`diff-${file.path}`}
      data-testid="code-diff-file"
    >
      <header className="chrome flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
        <Button
          variant="minimal"
          size="icon"
          aria-label={open ? tr("code.diff.collapse") : tr("code.diff.expand")}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
        <span className="font-mono">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <Badge variant="outline">{kindLabel[file.kind]}</Badge>
        {file.oldMode && file.newMode && file.oldMode !== file.newMode && (
          <span className="text-muted-foreground font-mono text-xs">
            {file.oldMode} → {file.newMode}
          </span>
        )}
        {file.additions !== undefined && (
          <span className="text-xs">
            <span className="text-green-600 dark:text-green-400">
              +{file.additions}
            </span>{" "}
            <span className="text-red-600 dark:text-red-400">
              -{file.deletions}
            </span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {props.renderFileHeaderActions?.(file)}
        </span>
      </header>
      {open && (
        <div className="hljs overflow-x-auto font-mono text-xs">
          {loading && (
            <p className="text-muted-foreground p-3">
              {tr("code.diff.loading")}
            </p>
          )}
          {file.status === "binary" && (
            <p className="text-muted-foreground p-3">
              {tr("code.diff.binary")}
            </p>
          )}
          {file.status === "too_large" && (
            <p className="text-muted-foreground p-3">
              {tr("code.diff.tooLarge")}
            </p>
          )}
          {file.status === "submodule" && (
            <p className="text-muted-foreground p-3">
              {tr("code.diff.submodule", {
                args: [
                  `${file.oldSha?.slice(0, 7) ?? "-"} → ${file.newSha?.slice(0, 7) ?? "-"}`,
                ],
              })}
            </p>
          )}
          {file.status === "loaded" && hunks.length === 0 && (
            <p className="text-muted-foreground p-3">
              {tr("code.diff.noChange")}
            </p>
          )}
          {file.status === "loaded" && hunks.length > 0 && (
            <table className="w-full border-collapse">
              <tbody>
                {hunks.map((hunk, index) => {
                  const tokens = highlightHunk(hunk, language);
                  return (
                    <Fragment key={`h${index}`}>
                      {gap(index)}
                      <tr className="bg-hover-weak text-muted-foreground">
                        <td colSpan={4} className="px-2 py-0.5">
                          {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
                        </td>
                      </tr>
                      {hunk.lines.map((line, at) =>
                        row(
                          line.anchor,
                          line.kind,
                          line.oldLine,
                          line.newLine,
                          (tokens[at] ?? []).map((token, t) =>
                            token.className ? (
                              <span key={t} className={token.className}>
                                {token.value}
                              </span>
                            ) : (
                              <span key={t}>{token.value}</span>
                            ),
                          ),
                          line.anchor,
                        ),
                      )}
                    </Fragment>
                  );
                })}
                {gap(hunks.length)}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
};

export default CodeDiffFileView;
