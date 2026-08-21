import CopyCommand from "../home/CopyCommand.tsx";

export interface ProductHeroProps {
  name: string;
  tagline: string;
  lead: string;
  command?: string;
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

        {props.children}
      </div>
    </section>
  );
};

export default ProductHero;
