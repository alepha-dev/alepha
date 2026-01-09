import { Link } from "@alepha/react/router";
import { IconArrowRight, IconPackage } from "@tabler/icons-react";
import CodeDemo from "./CodeDemo.tsx";
import LightPillar from "./LightPillar.tsx";
import ScrollButton from "./ScrollButton.tsx";

const HeroSection = () => {
  return (
    <section
      id="hero"
      className="home-block container"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        paddingTop: 40,
        paddingBottom: 40,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100vh",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div
          className={"visible-md"}
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            pointerEvents: "none",
          }}
        >
          <LightPillar
            bottomColor="#c2255c"
            intensity={1}
            noiseIntensity={0.7}
            rotationSpeed={0.1}
            glowAmount={0.001}
            pillarRotation={150}
            pillarHeight={1}
          />
        </div>
      </div>
      <div className="intro-grid">
        {/* Left: Hero Text */}
        <div className="flex flex-col gap-6 intro-hero">
          <h1
            style={{
              fontSize: "clamp(28px, 7vw, 42px)",
              fontWeight: 700,
              margin: 0,
              color: "var(--color-text-bright)",
              lineHeight: 1.15,
            }}
          >
            TypeScript Framework
            <br />
            <span style={{ color: "var(--color-accent)" }}>Made Easy</span>
          </h1>

          <p
            style={{
              fontSize: "clamp(14px, 3.5vw, 17px)",
              color: "var(--color-text-muted)",
              maxWidth: 440,
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            Stop gluing libraries together. Alepha gives you APIs, databases,
            queues, React SSR, and more.{" "}
            <span style={{ color: "var(--color-text)" }}>
              All type-safe. All works out of the box.
            </span>
          </p>

          {/* Quick Actions */}
          <div className="flex gap-4 flex-wrap hero-buttons">
            <Link
              href="/docs/guides-introduction"
              style={{ textDecoration: "none" }}
            >
              <button
                type="button"
                className="hero-btn"
                style={{
                  background: "var(--color-accent)",
                  color: "#ffffff",
                  border: "none",
                  padding: "14px 32px",
                  borderRadius: 6,
                  fontFamily: "inherit",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                Get Started
                <span className="hero-icon hero-icon-arrow">
                  <IconArrowRight size={18} />
                </span>
              </button>
            </Link>
            <Link
              href="/docs/packages-alepha-core"
              style={{ textDecoration: "none" }}
            >
              <button
                type="button"
                className="hero-btn"
                style={{
                  background: "transparent",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
                  padding: "14px 32px",
                  borderRadius: 6,
                  fontFamily: "inherit",
                  fontSize: 15,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                Explore Packages
                <span className="hero-icon hero-icon-package">
                  <IconPackage size={18} />
                </span>
              </button>
            </Link>
          </div>
        </div>

        {/* Right: Code Demo - Hidden on mobile */}
        <div className="intro-code hidden-mobile">
          <CodeDemo />
        </div>
      </div>

      {/* Scroll to Features */}
      <ScrollButton targetId="features" label="See What's Included" />
    </section>
  );
};

export default HeroSection;
