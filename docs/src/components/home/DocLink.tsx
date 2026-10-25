import { Link } from "alepha/react/router";
import type { ReactNode } from "react";

export interface DocLinkProps {
  /**
   * Docs slug without the `/docs/` prefix, e.g. `packages-alepha-api-users`.
   * Slugs are the filenames generated into `apps/docs/.gen`.
   */
  to: string;
  children: ReactNode;
}

/**
 * One place for the `/docs/` prefix and the in-prose link treatment, so the
 * front page can point at the docs without every section restating both.
 */
const DocLink = (props: DocLinkProps) => {
  return (
    <Link href={`/docs/${props.to}`} className="doc-link">
      {props.children}
    </Link>
  );
};

export default DocLink;
