import { useEffect, useState } from "react";
import { apiFeatures, coreFeatures } from "../../config/features.ts";
import PackageChip from "./PackageChip.tsx";
import ScrollButton from "./ScrollButton.tsx";

const FeaturesSection = () => {
  const [activeChip, setActiveChip] = useState<{ id: string; reverse: boolean } | null>(null);

  useEffect(() => {
    const allChips = [
      ...coreFeatures.map((_, i) => `core-${i}`),
      ...apiFeatures.map((_, i) => `api-${i}`),
    ];

    const triggerAnimation = () => {
      const randomChip = allChips[Math.floor(Math.random() * allChips.length)];
      const reverse = Math.random() > 0.5;
      setActiveChip({ id: randomChip, reverse });
      // Animation lasts 4s
      setTimeout(() => setActiveChip(null), 4000);
    };

    const initialDelay = setTimeout(triggerAnimation, 2000);
    const interval = setInterval(triggerAnimation, 6000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, []);

  return (
    <section
      id="features"
      className="home-block"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "var(--color-bg-elevated)",
        borderTop: "1px solid var(--color-border)",
        borderBottom: "1px solid var(--color-border)",
        position: "relative",
        paddingTop: "clamp(40px, 8vw, 60px)",
        paddingBottom: "clamp(40px, 8vw, 60px)",
        paddingLeft: "var(--space-4)",
        paddingRight: "var(--space-4)",
      }}
    >
      {/* Dotted grid pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(circle, var(--color-dot-grid) 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
          pointerEvents: "none",
        }}
      />
      {/* Subtle accent glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(var(--color-accent-rgb), 0.04) 0%, transparent 50%)",
          pointerEvents: "none",
        }}
      />
      <div className="container" style={{ position: "relative" }}>
        {/* Section Title */}
        <div
          className="flex flex-col items-center gap-3"
          style={{ marginBottom: "clamp(32px, 8vw, 64px)" }}
        >
          <h2
            style={{
              fontSize: "clamp(24px, 6vw, 36px)",
              fontWeight: 600,
              margin: 0,
              color: "var(--color-text-bright)",
            }}
          >
            Batteries Included
          </h2>
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: "clamp(14px, 3vw, 16px)",
              margin: 0,
              textAlign: "center",
            }}
          >
            Everything you need to build production-ready applications.
          </p>
        </div>

        {/* Core Packages */}
        <div style={{ marginBottom: 40 }}>
          <div className="flex items-center gap-3 mb-4">
            <span
              style={{
                color: "var(--color-accent)",
                fontFamily: "monospace",
                fontSize: 14,
              }}
            >
              {"//"}
            </span>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                margin: 0,
                color: "var(--color-text)",
              }}
            >
              Core Primitives
            </h3>
          </div>
          <div
            className="features-grid"
            style={{ display: "flex", flexWrap: "wrap", gap: 10 }}
          >
            {coreFeatures.map((feature, index) => (
              <PackageChip
                key={feature.title}
                feature={feature}
                index={index}
                isActive={activeChip?.id === `core-${index}`}
                isReverse={activeChip?.id === `core-${index}` && activeChip.reverse}
              />
            ))}
          </div>
        </div>

        {/* Application Modules */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span
              style={{
                color: "var(--color-accent)",
                fontFamily: "monospace",
                fontSize: 14,
              }}
            >
              {"//"}
            </span>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                margin: 0,
                color: "var(--color-text)",
              }}
            >
              Application Modules
            </h3>
          </div>
          <div
            className="features-grid"
            style={{ display: "flex", flexWrap: "wrap", gap: 10 }}
          >
            {apiFeatures.map((feature, index) => (
              <PackageChip
                key={feature.title}
                feature={feature}
                index={index}
                isActive={activeChip?.id === `api-${index}`}
                isReverse={activeChip?.id === `api-${index}` && activeChip.reverse}
              />
            ))}
          </div>
        </div>

        {/* Scroll to More */}
        <div className="flex justify-center">
          <ScrollButton targetId="more" label="Get Started" />
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
