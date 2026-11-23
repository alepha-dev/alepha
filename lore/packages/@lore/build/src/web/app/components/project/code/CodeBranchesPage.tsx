import { Badge, Button, TimeAgo, useDialog } from "@alepha/ui";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { GitCompare, Trash2 } from "lucide-react";

import type { CodeBrowserController } from "../../../../../api/controllers/CodeBrowserController.ts";
import type { codeBranchSchema } from "../../../../../api/schemas/codeBranchSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { codeHref, encodeCodePath } from "./codeHref.ts";

type Branch = Infer<typeof codeBranchSchema>;

/**
 * Every branch (#Q4137): its last commit, how far it is ahead of and behind
 * the default branch (capped, "100+"), a compare link, and a delete for a
 * member with `code:write`, confirmed first, never on the default branch.
 */
const CodeBranchesPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const api = useClient<CodeBrowserController>();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  const slug = detail?.repository.slug ?? "";
  const { data, refetch } = useQuery(
    {
      enabled: Boolean(project && detail),
      key: ["code-branches", project?.id, slug],
      handler: async () =>
        api.listCodeBranches({ params: { projectId: project!.id, slug } }),
    },
    [project?.id, slug],
  );
  const remove = useAction<[branch: Branch], boolean>(
    {
      handler: async (_ctx, branch) => {
        const ok = await dialog.confirm({
          title: tr("code.branches.delete.title", { args: [branch.name] }),
          description: tr("code.branches.delete.description"),
          confirmLabel: tr("code.branches.delete.confirm"),
          destructive: true,
        });
        if (!ok) return false;
        await api.deleteCodeBranch({
          params: { projectId: project!.id, slug },
          query: { name: branch.name },
        });
        await refetch();
        return true;
      },
    },
    [api, dialog, project?.id, slug],
  );
  if (!project || !detail) return null;
  const canDelete = canInProject(project, "code:write");
  const count = (value: number, capped: boolean) =>
    capped ? `${value}+` : String(value);

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="code-branches">
      <ul className="divide-border divide-y rounded-md border text-sm">
        {(data?.branches ?? []).map((branch) => (
          <li
            key={branch.name}
            className="flex flex-wrap items-center gap-3 px-3 py-2"
            data-testid="code-branch-row"
          >
            <Link
              href={codeHref("tree", project.slug, slug, branch.name)}
              className="font-mono font-medium hover:underline"
            >
              {branch.name}
            </Link>
            {branch.isDefault && (
              <Badge variant="outline">{tr("code.branches.default")}</Badge>
            )}
            <span className="text-muted-foreground min-w-0 grow truncate text-xs">
              {branch.commit?.subject}
              {branch.commit && (
                <>
                  {" · "}
                  <TimeAgo value={branch.commit.committedAt * 1000} />
                </>
              )}
            </span>
            {!branch.isDefault && (
              <span
                className="text-muted-foreground text-xs"
                data-testid="code-branch-counts"
              >
                {branch.indexing
                  ? tr("code.repo.indexing")
                  : tr("code.branches.counts", {
                      args: [
                        count(branch.ahead, branch.aheadCapped),
                        count(branch.behind, branch.behindCapped),
                      ],
                    })}
              </span>
            )}
            {!branch.isDefault && (
              <Link
                href={`/${project.slug}/code/${slug}/compare/${encodeCodePath(detail.repository.defaultBranch)}...${encodeCodePath(branch.name)}`}
                className="text-muted-foreground hover:text-foreground"
                aria-label={tr("code.branches.compare")}
              >
                <GitCompare className="size-4" />
              </Link>
            )}
            {!branch.isDefault && canDelete && (
              <Button
                variant="minimal"
                size="icon"
                aria-label={tr("code.branches.delete.label", {
                  args: [branch.name],
                })}
                disabled={remove.loading}
                onClick={() => void remove.run(branch)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CodeBranchesPage;
