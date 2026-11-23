import { TimeAgo } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import CodeCloneBox from "./CodeCloneBox.tsx";

/**
 * A repository's first tab (#Q4133): its last commit and how to clone it,
 * or, before the first push, how to make one.
 */
const CodeRepoHome = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  if (!project || !detail) return null;
  const { repository, head } = detail;
  const clone = (
    <CodeCloneBox
      projectSlug={project.slug}
      repoSlug={repository.slug}
      cloneUrl={repository.cloneUrl}
    />
  );

  if (!head) {
    return (
      <div
        className="flex max-w-3xl flex-col gap-4 p-4"
        data-testid="code-repo-empty"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">
            {tr("code.repo.empty.title")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {tr("code.repo.empty.description")}
          </p>
        </div>
        {clone}
        <pre className="bg-muted text-muted-foreground overflow-x-auto rounded-md p-3 text-xs">
          <code>{`git remote add lore ${repository.cloneUrl}\ngit push lore ${repository.defaultBranch}`}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="code-repo-home">
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-medium">{head.authorName}</span>
        <span className="truncate">{head.subject}</span>
        <code className="text-muted-foreground font-mono text-xs">
          {head.sha.slice(0, 7)}
        </code>
        <TimeAgo
          value={head.committedAt * 1000}
          className="text-muted-foreground text-xs"
        />
      </div>
      <div className="max-w-3xl">{clone}</div>
    </div>
  );
};

export default CodeRepoHome;
