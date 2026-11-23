import { TimeAgo } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { FileText, Folder, FolderGit2 } from "lucide-react";

import type { CodeBrowserController } from "../../../../../api/controllers/CodeBrowserController.ts";
import type { codeTreeSchema } from "../../../../../api/schemas/codeTreeSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { codeHref } from "./codeHref.ts";
import CodeMarkdown from "./CodeMarkdown.tsx";
import CodePathCrumbs from "./CodePathCrumbs.tsx";
import CodeRevisionMenu from "./CodeRevisionMenu.tsx";

export interface CodeTreePageProps {
  tree: Infer<typeof codeTreeSchema>;
}

/**
 * A directory at a revision (#Q4134): its entries, folders first, each
 * with the last commit that touched it, and its README rendered under them.
 *
 * The last commits are read after the tree has drawn, in one request for
 * the whole directory: the tree is the backend's and immediate, the column
 * is the commit index's and may still be catching up.
 */
const CodeTreePage = (props: CodeTreePageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  const api = useClient<CodeBrowserController>();
  const { tree } = props;
  const repoSlug = detail?.repository.slug ?? "";
  const at = `${tree.revision.name}${tree.path ? `/${tree.path}` : ""}`;
  const { data: commits } = useQuery(
    {
      enabled: Boolean(project && detail && tree.entries.length),
      key: [
        "code-tree-commits",
        project?.id,
        repoSlug,
        tree.revision.sha,
        tree.path,
      ],
      handler: async () =>
        api.getCodeTreeCommits({
          params: { projectId: project!.id, slug: repoSlug },
          body: { at, names: tree.entries.map((entry) => entry.name) },
        }),
      onError: () => {},
    },
    [project?.id, repoSlug, tree.revision.sha, tree.path],
  );
  if (!project || !detail) return null;
  const byName = new Map(
    (commits?.entries ?? []).map((entry) => [entry.name, entry.commit]),
  );
  const revision = tree.revision.name;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="code-tree">
      <div className="flex flex-wrap items-center gap-3">
        <CodeRevisionMenu
          projectSlug={project.slug}
          revision={tree.revision}
          kind="tree"
          path={tree.path}
        />
        <CodePathCrumbs
          projectSlug={project.slug}
          repoSlug={repoSlug}
          revision={revision}
          path={tree.path}
        />
        {commits?.indexing && (
          <span
            className="text-muted-foreground ml-auto text-xs"
            data-testid="code-tree-indexing"
          >
            {tr("code.repo.indexing")}
          </span>
        )}
      </div>

      <ul className="divide-border divide-y rounded-md border text-sm">
        {tree.entries.map((entry) => {
          const commit = byName.get(entry.name);
          const Icon =
            entry.type === "tree"
              ? Folder
              : entry.type === "commit"
                ? FolderGit2
                : FileText;
          return (
            <li
              key={entry.name}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]"
              data-testid="code-tree-entry"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
                {entry.type === "commit" ? (
                  <span className="truncate" title={entry.sha}>
                    {entry.name}
                  </span>
                ) : (
                  <Link
                    href={codeHref(
                      entry.type === "tree" ? "tree" : "blob",
                      project.slug,
                      repoSlug,
                      revision,
                      entry.path,
                    )}
                    className="truncate hover:underline"
                  >
                    {entry.name}
                  </Link>
                )}
              </span>
              <span className="text-muted-foreground hidden truncate md:block">
                {commit?.subject}
              </span>
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {commit && <TimeAgo value={commit.committedAt * 1000} />}
              </span>
            </li>
          );
        })}
      </ul>

      {tree.readme && (
        <section className="rounded-md border p-4" data-testid="code-readme">
          <h2 className="text-muted-foreground mb-2 font-mono text-xs">
            {tree.readme.path.slice(tree.readme.path.lastIndexOf("/") + 1)}
          </h2>
          <CodeMarkdown
            text={tree.readme.text}
            path={tree.readme.path}
            projectId={project.id}
            projectSlug={project.slug}
            repoSlug={repoSlug}
            revision={revision}
            sha={tree.revision.sha}
          />
        </section>
      )}
    </div>
  );
};

export default CodeTreePage;
