import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  TimeAgo,
} from "@alepha/ui";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { FolderGit2 } from "lucide-react";

import type { codeRepositorySchema } from "../../../../../api/schemas/codeRepositorySchema.ts";
import CodeCloneBox from "./CodeCloneBox.tsx";

export interface CodeRepositoriesProps {
  repositories: Infer<typeof codeRepositorySchema>[];
}

/**
 * `/<project>/code` (#Q4133): the project's repositories, each with its
 * default branch's last commit and how to clone it. A project with one
 * repository never shows this page: its loader opens the repository.
 */
const CodeRepositories = (props: CodeRepositoriesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  if (!project) return null;

  if (props.repositories.length === 0) {
    return (
      <div className="p-6">
        <Empty data-testid="code-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderGit2 />
            </EmptyMedia>
            <EmptyTitle>{tr("code.repos.empty.title")}</EmptyTitle>
            <EmptyDescription>
              {canInProject(project, "code:admin")
                ? tr("code.repos.empty.admin")
                : tr("code.repos.empty.member")}
            </EmptyDescription>
          </EmptyHeader>
          <code className="bg-muted rounded px-2 py-1 font-mono text-xs">
            lore code repo create {project.slug} --project {project.slug}
          </code>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="code-repositories">
      <h1 className="text-xl font-semibold">{tr("project.menu.code")}</h1>
      <ul className="divide-border flex flex-col divide-y rounded-md border">
        {props.repositories.map((repository) => (
          <li
            key={repository.id}
            className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/${project.slug}/code/${repository.slug}`}
                className="text-base font-semibold hover:underline"
              >
                {repository.slug}
              </Link>
              <span className="text-muted-foreground text-xs">
                {repository.defaultBranch}
              </span>
              {repository.lastCommit ? (
                <span className="text-muted-foreground truncate text-sm">
                  {repository.lastCommit.subject} ·{" "}
                  {repository.lastCommit.authorName} ·{" "}
                  <TimeAgo value={repository.lastCommit.committedAt * 1000} />
                </span>
              ) : (
                <span className="text-muted-foreground text-sm">
                  {tr("code.repo.empty.title")}
                </span>
              )}
            </div>
            <div className="md:w-[28rem]">
              <CodeCloneBox
                projectSlug={project.slug}
                repoSlug={repository.slug}
                cloneUrl={repository.cloneUrl}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CodeRepositories;
