import { currentProjectAtom, type I18n } from "@lore/core/web";
import type { Infer } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { codeCompareSchema } from "../../../../../api/schemas/codeCompareSchema.ts";
import type { codeDiffSchema } from "../../../../../api/schemas/codeDiffSchema.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import CodeDiff from "./CodeDiff.tsx";
import { encodeCodePath } from "./codeHref.ts";
import CodeQuestChips from "./CodeQuestChips.tsx";

export interface CodeComparePageProps {
  compare: Infer<typeof codeCompareSchema>;
  diff?: Infer<typeof codeDiffSchema>;
}

/**
 * `/compare/<base>...<head>` (#Q4137): what `head` has since its merge base
 * with `base`, its commits and its diff from the merge base. The page a
 * pull request is opened from (#E169).
 */
const CodeComparePage = (props: CodeComparePageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  if (!project || !detail) return null;
  const { compare, diff } = props;
  const slug = detail.repository.slug;
  const count = (value: number, capped: boolean) =>
    capped ? `${value}+` : String(value);
  const self = `/${project.slug}/code/${slug}/compare/${encodeCodePath(compare.base.name)}...${encodeCodePath(compare.head.name)}`;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="code-compare">
      <h2 className="font-mono text-sm">
        {compare.base.name} ... {compare.head.name}
      </h2>
      {compare.indexing ? (
        <p className="text-muted-foreground text-sm">
          {tr("code.repo.indexing")}
        </p>
      ) : (
        <p
          className="text-muted-foreground text-sm"
          data-testid="code-compare-counts"
        >
          {tr("code.compare.counts", {
            args: [
              count(compare.ahead, compare.aheadCapped),
              count(compare.behind, compare.behindCapped),
            ],
          })}
        </p>
      )}
      {!compare.mergeBase && !compare.indexing && (
        <p className="text-muted-foreground text-sm">
          {compare.mergeBaseCapped
            ? tr("code.compare.capped")
            : tr("code.compare.unrelated")}
        </p>
      )}
      {compare.commits.length > 0 && (
        <ul className="divide-border divide-y rounded-md border text-sm">
          {compare.commits.map((commit) => (
            <li key={commit.sha} className="flex items-center gap-3 px-3 py-2">
              <Link
                href={`/${project.slug}/code/${slug}/commit/${commit.sha}`}
                className="min-w-0 grow truncate hover:underline"
              >
                {commit.subject}
              </Link>
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
      {diff && (
        <CodeDiff
          diff={diff}
          projectId={project.id}
          repoSlug={slug}
          from={diff.from}
          to={diff.to}
          onPage={(page) =>
            router.push(`${self}${page ? `?page=${page}` : ""}` as `/${string}`)
          }
        />
      )}
    </div>
  );
};

export default CodeComparePage;
