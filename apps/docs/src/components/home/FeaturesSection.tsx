import { apiFeatures, coreFeatures } from "../../config/features.ts";
import PackageChip from "./PackageChip.tsx";
import ScrollButton from "./ScrollButton.tsx";

const FeaturesSection = () => {
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
      {/* Noise texture overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "256px 256px",
          opacity: 0.05,
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
