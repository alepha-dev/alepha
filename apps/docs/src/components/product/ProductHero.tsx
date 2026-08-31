import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "alepha/react/router";

import CopyCommand from "../home/CopyCommand.tsx";

export interface ProductHeroProps {
  name: string;
  tagline: string;
  lead: string;
  command?: string;
  /**
   * Where this product's guides start. Rendered as the same primary
   * "Get Started" the framework home uses, in the same place.
   *
   * Without it a product's docs are reachable only from the sidebar of a page
   * you already have to be on (quest #1604). It lives on the shared hero
   * rather than in each product page so a third product cannot invent a third
   * way in.
   */
  docsHref?: string;
  /**
   * Anything a product wants under its command, such as a link to a hosted
   * instance.
   */
  children?: React.ReactNode;
}

/**
 * Shared hero for a product front page.
 *
 * The framework page keeps its own bespoke hero (it carries the runtime
 * switcher); this is the shell every other product reuses so a new one costs a
 * config object rather than a layout.
 */
const ProductHero = (props: ProductHeroProps) => {
  return (
    <section className="home-block hero-section container">
      <div className="intro-hero flex flex-col gap-6">
        <h1 className="hero-title">
          {props.name}
          <br />
          <span className="hero-title-accent">{props.tagline}</span>
        </h1>

        <p className="hero-lead">{props.lead}</p>

        {props.command ? <CopyCommand command={props.command} /> : null}

        {props.docsHref ? (
          <div className="hero-buttons flex flex-wrap gap-4">
            <Link href={props.docsHref} className="hero-link">
              <button type="button" className="hero-btn hero-btn-primary">
                Get Started
                <span className="hero-icon hero-icon-arrow">
                  <IconArrowRight size={18} />
                </span>
              </button>
            </Link>
          </div>
        ) : null}

        {props.children}
      </div>
    </section>
  );
};

export default ProductHero;
