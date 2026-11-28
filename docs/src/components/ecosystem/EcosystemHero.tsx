import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "alepha/react/router";

import LightPillar from "../home/LightPillar.tsx";
import ScrollButton from "../home/ScrollButton.tsx";

/**
 * The front page's hero: the framework home's logo and pillar, with a lead
 * that names the three products instead of the framework alone.
 */
const EcosystemHero = () => {
  return (
    <section id="hero" className="home-block hero-section container">
      <div className={"light-pillar"}>
        <LightPillar
          intensity={1}
          noiseIntensity={0.7}
          rotationSpeed={0.1}
          glowAmount={0.001}
          pillarRotation={150}
          pillarHeight={1}
        />
      </div>

      <div className="hero-centered">
        {/* The logo is the headline, as on the framework's page: the name is
            the image's alt text, so the page keeps a real `h1`. */}
        <h1 className="hero-brand">
          <img
            src="/logo.svg"
            alt="Alepha"
            className="hero-logo"
            width={280}
            height={280}
          />
        </h1>

        <p className="hero-lead hero-lead-wide">
          Alepha is three open-source products on one version:{" "}
          <Link href="/framework" className="hero-lead-link">
            the framework
          </Link>{" "}
          you build a full-stack TypeScript app with,{" "}
          <Link href="/lore" className="hero-lead-link">
            Lore
          </Link>
          , where its team and their agents plan, remember and ship it, and{" "}
          <Link href="/bay" className="hero-lead-link">
            Bay
          </Link>
          , the server that runs it on a machine you own.
        </p>

        <div className="hero-buttons flex flex-wrap gap-4">
          <Link href="/framework" className="hero-link">
            <button type="button" className="hero-btn hero-btn-primary">
              The framework
              <span className="hero-icon hero-icon-arrow">
                <IconArrowRight size={18} />
              </span>
            </button>
          </Link>
          <Link href="/lore" className="hero-link">
            <button type="button" className="hero-btn hero-btn-ghost">
              Lore
            </button>
          </Link>
          <Link href="/bay" className="hero-link">
            <button type="button" className="hero-btn hero-btn-ghost">
              Bay
            </button>
          </Link>
        </div>
      </div>

      <ScrollButton targetId="products" />
    </section>
  );
};

export default EcosystemHero;
