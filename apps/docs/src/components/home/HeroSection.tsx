import { IconArrowRight, IconBook } from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import CopyCommand from "./CopyCommand.tsx";
import LightPillar from "./LightPillar.tsx";
import ScrollButton from "./ScrollButton.tsx";

const HeroSection = () => {
  return (
    <section id="hero" className="home-block container hero-section">
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
        {/* The logo IS the headline. No wordmark: the name is carried by the
            image's alt text, so the page still has a real `h1` for search and
            screen readers without printing it on screen. */}
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
          Alepha is a full-stack{" "}
          <a
            href="https://www.typescriptlang.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hero-lead-link"
          >
            TypeScript
          </a>{" "}
          ecosystem. One small surface of typed primitives covers the server,
          the database, auth, background work and{" "}
          <a
            href="https://react.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="hero-lead-link"
          >
            React
          </a>
          , so a weekend project and a distributed system are the same code with
          different infrastructure underneath.
        </p>

        <CopyCommand command="npx alepha@latest init my-app" />

        <div className="flex gap-4 flex-wrap hero-buttons">
          <Link href="/docs/guides-getting-started" className="hero-link">
            <button type="button" className="hero-btn hero-btn-primary">
              Get Started
              <span className="hero-icon hero-icon-arrow">
                <IconArrowRight size={18} />
              </span>
            </button>
          </Link>
          <Link href="/docs/guides-introduction" className="hero-link">
            <button type="button" className="hero-btn hero-btn-ghost">
              Why Alepha
              <span className="hero-icon">
                <IconBook size={18} />
              </span>
            </button>
          </Link>
        </div>
      </div>

      {/* Generic label on purpose: it targets whatever block 2 currently is, and
          a label naming that block goes stale the moment the order changes. */}
      <ScrollButton targetId="seam" label="Explore" />
    </section>
  );
};

export default HeroSection;
