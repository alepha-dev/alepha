import { TimeAgo } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { codeCommitDetailSchema } from "../../../../../api/schemas/codeCommitDetailSchema.ts";
import type { codeDiffSchema } from "../../../../../api/schemas/codeDiffSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import CodeDiff from "./CodeDiff.tsx";
import { codeHref } from "./codeHref.ts";
import CodeQuestChips from "./CodeQuestChips.tsx";

export interface CodeCommitPageProps {
  commit: Infer<typeof codeCommitDetailSchema>;
  diff: Infer<typeof codeDiffSchema>;
}

/**
 * One commit, `/commit/<sha>` (#Q4136): its message, who wrote and who
 * committed it, its parents, its quests, and its diff against its first
 * parent (from the empty tree for a root commit; a merge says which
 * parent it is diffed against).
 */
const CodeCommitPage = (props: CodeCommitPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  if (!project || !detail) return null;
  const { commit, diff } = props;
  const repoSlug = detail.repository.slug;
  const commitHref = (sha: string) =>
    `/${project.slug}/code/${repoSlug}/commit/${sha}` as const;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="code-commit">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{commit.subject}</h2>
        {commit.body && (
          <pre className="text-muted-foreground text-sm whitespace-pre-wrap">
            {commit.body}
          </pre>
        )}
        <CodeQuestChips projectSlug={project.slug} quests={commit.quests} />
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>
            {tr("code.commit.authored", {
              args: [commit.member?.username ?? commit.author.name],
            })}{" "}
            <TimeAgo value={commit.author.at * 1000} />
          </span>
          {(commit.committer.email !== commit.author.email ||
            commit.committer.name !== commit.author.name) && (
            <span>
              {tr("code.commit.committed", { args: [commit.committer.name] })}{" "}
              <TimeAgo value={commit.committer.at * 1000} />
            </span>
          )}
          <code className="font-mono" data-testid="code-commit-sha">
            {commit.sha}
          </code>
          <Link
            href={codeHref("tree", project.slug, repoSlug, commit.sha)}
            className="hover:text-foreground underline"
          >
            {tr("code.commit.browse")}
          </Link>
        </div>
        <div
          className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
          data-testid="code-commit-parents"
        >
          {commit.parents.length === 0 ? (
            <span>{tr("code.commit.root")}</span>
          ) : (
            <>
              <span>
                {tr(
                  commit.parents.length > 1
                    ? "code.commit.parents"
                    : "code.commit.parent",
                )}
              </span>
              {commit.parents.map((parent) => (
                <Link
                  key={parent}
                  href={commitHref(parent)}
                  className="font-mono hover:underline"
                >
                  {parent.slice(0, 7)}
                </Link>
              ))}
              {commit.parents.length > 1 && (
                <span>
                  {tr("code.commit.mergeDiff", {
                    args: [commit.parents[0]!.slice(0, 7)],
                  })}
                </span>
              )}
            </>
          )}
        </div>
      </header>
      <CodeDiff
        diff={diff}
        projectId={project.id}
        repoSlug={repoSlug}
        from={diff.from}
        to={diff.to}
        onPage={(page) =>
          router.push(
            `${commitHref(commit.sha)}${page ? `?page=${page}` : ""}` as `/${string}`,
          )
        }
      />
    </div>
  );
};

export default CodeCommitPage;
