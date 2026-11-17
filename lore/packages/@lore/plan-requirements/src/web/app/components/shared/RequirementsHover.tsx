import { currentProjectAtom, WikiLinkHoverProvider } from "@lore/core/web";
import { useStore } from "alepha/react";
import type { ReactNode } from "react";

export interface RequirementsHoverProps {
  children: ReactNode;
  className?: string;
}

/**
 * Hover previews for every reference drawn under it (#E153): the provider
 * a folio or a quest body sits in, around a Requirements surface, so a
 * `ReferenceLink` previews like a `[[#U7]]` does.
 */
const RequirementsHover = (props: RequirementsHoverProps) => {
  const [project] = useStore(currentProjectAtom);
  if (!project) return <>{props.children}</>;
  return (
    <WikiLinkHoverProvider
      projectId={project.id}
      projectSlug={project.slug}
      attachments={[]}
      className={props.className}
    >
      {props.children}
    </WikiLinkHoverProvider>
  );
};

export default RequirementsHover;
