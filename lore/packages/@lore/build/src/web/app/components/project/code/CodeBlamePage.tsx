import { TimeAgo } from "@alepha/ui";
import { highlightLanguageOf, highlightLines } from "@alepha/ui/markdown";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { History } from "lucide-react";
import { useMemo, useState } from "react";

import type { CodeBrowserController } from "../../../../../api/controllers/CodeBrowserController.ts";
import type { codeBlameSchema } from "../../../../../api/schemas/codeBlameSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { codeHref } from "./codeHref.ts";
import CodePathCrumbs from "./CodePathCrumbs.tsx";
import CodeQuestChips from "./CodeQuestChips.tsx";
import CodeRevisionMenu from "./CodeRevisionMenu.tsx";

export interface CodeBlamePageProps {
  blame: Infer<typeof codeBlameSchema>;
}

/**
 * A file's blame, `/blame/<revision>/<path>` (#Q4138): its lines in runs of
 * one commit, each run headed by the commit (sha, author, age, subject),
 * the quests behind it, and a link to the blame before it (its first
 * parent, under the name the file had then).
 *
 * While the walk finishes as a job (`pending`) the page asks again every two
 * seconds, and stops as soon as the answer is `ready` or `partial`; the
 * query skips its ticks on a hidden tab (#Q3860).
 */
const CodeBlamePage = (props: CodeBlamePageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<CodeBrowserController>();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  const slug = detail?.repository.slug ?? "";
  const [shown, setShown] = useState(props.blame);
  const pending = shown.status === "pending";
  useQuery(
    {
      enabled: Boolean(project) && pending,
      key: ["code-blame", project?.id, slug, shown.revision.sha, shown.path],
      runEvery: pending ? [2, "seconds"] : undefined,
      handler: async () => {
        const next = await api.getCodeBlame({
          params: { projectId: project!.id, slug },
          query: { ref: shown.revision.sha, path: shown.path },
        });
        if (next.status !== "pending") setShown(next);
        return next;
      },
      onError: () => {},
    },
    [project?.id, slug, pending],
  );
  const tokens = useMemo(
    () =>
      shown.text
        ? highlightLines(
            shown.text.endsWith("\n") ? shown.text.slice(0, -1) : shown.text,
            highlightLanguageOf(shown.path),
          )
        : [],
    [shown.text, shown.path],
  );
  if (!project || !detail) return null;
  const commits = new Map(shown.commits.map((it) => [it.sha, it]));

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="code-blame">
      <div className="flex flex-wrap items-center gap-3">
        <CodeRevisionMenu
          projectSlug={project.slug}
          revision={shown.revision}
          kind="blame"
          path={shown.path}
        />
        <CodePathCrumbs
          projectSlug={project.slug}
          repoSlug={slug}
          revision={shown.revision.name}
          path={shown.path}
        />
        {shown.status === "pending" && (
          <span
            className="text-muted-foreground ml-auto text-xs"
            data-testid="code-blame-pending"
          >
            {tr("code.blame.pending")}
          </span>
        )}
      </div>
      {shown.status === "too_large" && (
        <p className="text-muted-foreground text-sm">
          {tr("code.blame.tooLarge")}
        </p>
      )}
      {shown.status === "indexing" && (
        <p className="text-muted-foreground text-sm">
          {tr("code.repo.indexing")}
        </p>
      )}
      {shown.status === "partial" && shown.stoppedAtSha && (
        <p className="text-muted-foreground text-sm">
          {tr("code.blame.partial", { args: [shown.stoppedAtSha.slice(0, 7)] })}
        </p>
      )}
      {tokens.length > 0 && (
        <div className="hljs overflow-x-auto rounded-md border text-xs">
          <table className="w-full border-collapse font-mono">
            <tbody>
              {shown.ranges.map((range) => {
                const commit = range.commitSha
                  ? commits.get(range.commitSha)
                  : undefined;
                const rows = [];
                for (
                  let line = range.startLine;
                  line <= range.endLine;
                  line++
                ) {
                  rows.push(line);
                }
                return rows.map((line, at) => (
                  <tr
                    key={line}
                    id={`L${line}`}
                    className={at === 0 ? "border-t" : undefined}
                    data-testid={at === 0 ? "code-blame-run" : undefined}
                  >
                    <td className="w-72 max-w-72 px-2 align-top font-sans">
                      {at === 0 && (
                        <div className="flex flex-col gap-0.5 py-1">
                          {commit ? (
                            <>
                              <Link
                                href={`/${project.slug}/code/${slug}/commit/${commit.sha}`}
                                className="truncate hover:underline"
                                title={commit.subject}
                              >
                                {commit.subject}
                              </Link>
                              <span className="text-muted-foreground flex items-center gap-2">
                                <code className="font-mono">
                                  {commit.sha.slice(0, 7)}
                                </code>
                                <span className="truncate">
                                  {commit.member?.username ?? commit.authorName}
                                </span>
                                <TimeAgo value={commit.committedAt * 1000} />
                                {commit.parents[0] && (
                                  <Link
                                    href={codeHref(
                                      "blame",
                                      project.slug,
                                      slug,
                                      commit.parents[0],
                                      range.originalPath ?? shown.path,
                                    )}
                                    aria-label={tr("code.blame.before")}
                                    title={tr("code.blame.before")}
                                    className="hover:text-foreground"
                                  >
                                    <History className="size-3.5" />
                                  </Link>
                                )}
                              </span>
                              <CodeQuestChips
                                projectSlug={project.slug}
                                quests={commit.quests}
                              />
                            </>
                          ) : (
                            <span className="text-muted-foreground">
                              {tr("code.blame.older", {
                                args: [shown.stoppedAtSha?.slice(0, 7) ?? ""],
                              })}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="text-muted-foreground w-1 px-2 text-right align-top select-none">
                      {line}
                    </td>
                    <td className="pr-4 align-top whitespace-pre">
                      {(tokens[line - 1] ?? []).map((token, t) =>
                        token.className ? (
                          <span key={t} className={token.className}>
                            {token.value}
                          </span>
                        ) : (
                          <span key={t}>{token.value}</span>
                        ),
                      )}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CodeBlamePage;
