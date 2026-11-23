import { Button, TimeAgo } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { codeLogSchema } from "../../../../../api/schemas/codeLogSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { codeHref } from "./codeHref.ts";
import CodePathCrumbs from "./CodePathCrumbs.tsx";
import CodeQuestChips from "./CodeQuestChips.tsx";
import CodeRevisionMenu from "./CodeRevisionMenu.tsx";

export interface CodeCommitsPageProps {
  log: Infer<typeof codeLogSchema>;
}

/**
 * A revision's history, `/commits/<revision>/<path>` (#Q4136): newest first,
 * of one file or folder when a path is given, each commit with its quests,
 * 30 a page. Read from the commit index, which says so while it is still
 * catching up.
 */
const CodeCommitsPage = (props: CodeCommitsPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  if (!project || !detail) return null;
  const { log } = props;
  const repoSlug = detail.repository.slug;
  const pageHref = (page: number) =>
    `${codeHref("commits", project.slug, repoSlug, log.revision.name, log.path)}${page ? `?page=${page}` : ""}` as `/${string}`;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="code-commits">
      <div className="flex flex-wrap items-center gap-3">
        <CodeRevisionMenu
          projectSlug={project.slug}
          revision={log.revision}
          kind="commits"
          path={log.path}
        />
        {log.path && (
          <CodePathCrumbs
            projectSlug={project.slug}
            repoSlug={repoSlug}
            revision={log.revision.name}
            path={log.path}
          />
        )}
      </div>
      {log.indexing ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="code-commits-indexing"
        >
          {tr("code.repo.indexing")}
        </p>
      ) : log.commits.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tr("code.commits.none")}
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {log.commits.map((commit) => (
            <li
              key={commit.sha}
              className="flex flex-col gap-1 px-3 py-2 md:flex-row md:items-center md:gap-3"
              data-testid="code-commit-row"
            >
              <div className="flex min-w-0 grow flex-col gap-1">
                <Link
                  href={`/${project.slug}/code/${repoSlug}/commit/${commit.sha}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {commit.subject}
                </Link>
                <span className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span>{commit.member?.username ?? commit.authorName}</span>
                  <TimeAgo value={commit.committedAt * 1000} />
                </span>
              </div>
              <CodeQuestChips
                projectSlug={project.slug}
                quests={commit.quests}
              />
              <code className="text-muted-foreground font-mono text-xs">
                {commit.sha.slice(0, 7)}
              </code>
            </li>
          ))}
        </ul>
      )}
      {(log.page > 0 || log.more) && (
        <div className="flex items-center gap-2">
          <Button
            variant="outlined"
            size="sm"
            disabled={log.page === 0}
            onClick={() => router.push(pageHref(log.page - 1))}
          >
            {tr("code.diff.previous")}
          </Button>
          <Button
            variant="outlined"
            size="sm"
            disabled={!log.more}
            onClick={() => router.push(pageHref(log.page + 1))}
          >
            {tr("code.diff.next")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default CodeCommitsPage;
