import { currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { codeTreeSchema } from "../../../../../api/schemas/codeTreeSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import CodeCloneBox from "./CodeCloneBox.tsx";
import CodeTreePage from "./CodeTreePage.tsx";

export interface CodeRepoHomeProps {
  tree?: Infer<typeof codeTreeSchema>;
}

/**
 * A repository's first tab (#Q4133): the default branch's root with its
 * README (#Q4134), or, before the first push, how to make one.
 */
const CodeRepoHome = (props: CodeRepoHomeProps) => {
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
    <div className="flex flex-col" data-testid="code-repo-home">
      {props.tree && <CodeTreePage tree={props.tree} />}
      <div className="max-w-3xl px-4 pb-4">{clone}</div>
    </div>
  );
};

export default CodeRepoHome;
