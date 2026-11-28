import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import type { ReactNode } from "react";

export interface EcosystemLaneProps {
  /**
   * The product's name, the lane's heading.
   */
  name: string;
  /**
   * One line on what the product is for.
   */
  tagline: string;
  /**
   * Its page on this site.
   */
  href: string;
  /**
   * Its guides.
   */
  docsHref: string;
  /**
   * A real artifact of the product: code, a screen, a terminal.
   */
  children: ReactNode;
}

/**
 * One product on the front page: what it is, where to read on, and something
 * it really produces beside the words.
 */
const EcosystemLane = (props: EcosystemLaneProps) => {
  return (
    <article className="eco-lane" aria-labelledby={`eco-${props.name}`}>
      <div className="eco-lane-text">
        <h3 id={`eco-${props.name}`} className="eco-lane-name">
          {props.name}
        </h3>
        <p className="eco-lane-tagline">{props.tagline}</p>
        <div className="eco-lane-links">
          <Link href={props.href} className="eco-lane-link">
            {props.name}
            <IconArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href={props.docsHref} className="eco-lane-link is-quiet">
            Guides
          </Link>
        </div>
      </div>
      <div className="eco-lane-artifact">{props.children}</div>
    </article>
  );
};

export default EcosystemLane;
