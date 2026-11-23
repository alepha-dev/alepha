import { TimeAgo } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Tag } from "lucide-react";

import type { CodeBrowserController } from "../../../../../api/controllers/CodeBrowserController.ts";
import { currentCodeRepoAtom } from "../../../atoms/currentCodeRepoAtom.ts";
import { codeHref } from "./codeHref.ts";

/**
 * Every tag and the commit it points at, an annotated one peeled (#Q4137).
 */
const CodeTagsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<CodeBrowserController>();
  const [project] = useStore(currentProjectAtom);
  const [detail] = useStore(currentCodeRepoAtom);
  const slug = detail?.repository.slug ?? "";
  const { data } = useQuery(
    {
      enabled: Boolean(project && detail),
      key: ["code-tags", project?.id, slug],
      handler: async () =>
        api.listCodeTags({ params: { projectId: project!.id, slug } }),
    },
    [project?.id, slug],
  );
  if (!project || !detail) return null;
  const tags = data?.tags ?? [];
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="code-tags">
      {data && tags.length === 0 && (
        <p className="text-muted-foreground text-sm">{tr("code.tags.none")}</p>
      )}
      <ul className="divide-border divide-y rounded-md border text-sm empty:hidden">
        {tags.map((tag) => (
          <li
            key={tag.name}
            className="flex flex-wrap items-center gap-3 px-3 py-2"
          >
            <Tag className="text-muted-foreground size-4" aria-hidden />
            <Link
              href={codeHref("tree", project.slug, slug, tag.name)}
              className="font-mono font-medium hover:underline"
            >
              {tag.name}
            </Link>
            <Link
              href={`/${project.slug}/code/${slug}/commit/${tag.sha}`}
              className="text-muted-foreground font-mono text-xs hover:underline"
            >
              {tag.sha.slice(0, 7)}
            </Link>
            <span className="text-muted-foreground min-w-0 grow truncate text-xs">
              {tag.commit?.subject}
            </span>
            {tag.commit && (
              <TimeAgo
                value={tag.commit.committedAt * 1000}
                className="text-muted-foreground text-xs"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CodeTagsPage;
