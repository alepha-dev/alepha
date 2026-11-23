import { Link } from "alepha/react/router";

import { codeHref } from "./codeHref.ts";

export interface CodePathCrumbsProps {
  projectSlug: string;
  repoSlug: string;
  revision: string;
  path: string;
}

/**
 * `repo / dir / sub / file`, each folder a link to its tree (#Q4134).
 */
const CodePathCrumbs = (props: CodePathCrumbsProps) => {
  const segments = props.path.split("/").filter(Boolean);
  return (
    <nav
      className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-sm"
      data-testid="code-path"
    >
      <Link
        href={codeHref(
          "tree",
          props.projectSlug,
          props.repoSlug,
          props.revision,
        )}
        className="font-semibold hover:underline"
      >
        {props.repoSlug}
      </Link>
      {segments.map((segment, index) => {
        const last = index === segments.length - 1;
        const path = segments.slice(0, index + 1).join("/");
        return (
          <span key={path} className="flex items-center gap-1">
            <span className="text-muted-foreground">/</span>
            {last ? (
              <span className="font-semibold">{segment}</span>
            ) : (
              <Link
                href={codeHref(
                  "tree",
                  props.projectSlug,
                  props.repoSlug,
                  props.revision,
                  path,
                )}
                className="hover:underline"
              >
                {segment}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
};

export default CodePathCrumbs;
