import {
  currentProjectAtom,
  ElementReferenceRegistry,
  formatReference,
} from "@lore/core/web";
import { useInject, useStore } from "alepha/react";
import { Link } from "alepha/react/router";
import type { MouseEvent, ReactNode } from "react";

export interface ReferenceLinkProps {
  kind: "quest" | "epic" | "persona" | "usecase" | "requirement";
  number: number;
  /**
   * Drawn after the reference, inside the link: a title, most often.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * A reference drawn as what it is everywhere else in Lore: a link to the
 * thing's page (#E153). The href is the one its kind registered for
 * `[[#U7]]`, so a `WikiLinkHoverProvider` above it draws the same hover
 * preview a wiki-link gets (`RequirementsHover`).
 *
 * A click does not reach a row or a card that is itself clickable.
 */
const ReferenceLink = (props: ReferenceLinkProps) => {
  const [project] = useStore(currentProjectAtom);
  const references = useInject(ElementReferenceRegistry);
  const label = formatReference(props.kind, props.number);
  const kind = references.kinds().find((it) => it.kind === props.kind);
  if (!project || !kind) {
    return (
      <span className={props.className}>
        <span className="font-semibold">{label}</span>
        {props.children ? <> {props.children}</> : null}
      </span>
    );
  }
  return (
    <Link
      href={kind.href(project.slug, { number: props.number } as never)}
      className={`hover:underline ${props.className ?? ""}`}
      onClick={(event: MouseEvent) => event.stopPropagation()}
    >
      <span className="font-semibold">{label}</span>
      {props.children ? <> {props.children}</> : null}
    </Link>
  );
};

export default ReferenceLink;
