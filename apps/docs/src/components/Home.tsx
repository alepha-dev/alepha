import { Link } from "@alepha/react";
import {
  IconArrowRight,
  IconBrandGithub,
  IconBrandNpm,
  IconCheck,
  IconChevronDown,
  IconCopy,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { snippets } from "../config/docs.ts";
import { apiFeatures, coreFeatures } from "../config/features.ts";
import StatusBar from "./layout/StatusBar.tsx";

// =============================================================================
// 3D CONNECTED DOTS BACKGROUND
// =============================================================================

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

const ParticleNetwork = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let particles: Particle[] = [];
    const particleCount = 80;
    const connectionDistance = 150;
    const depth = 400;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
    };

    const initParticles = () => {
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          z: Math.random() * depth,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          vz: (Math.random() - 0.5) * 0.3,
        });
      }
    };

    const project = (p: Particle) => {
      const scale = depth / (depth + p.z);
      const x = p.x * scale + (canvas.width * (1 - scale)) / 2;
      const y = p.y * scale + (canvas.height * (1 - scale)) / 2;
      return { x, y, scale };
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        if (p.z < 0) p.z = depth;
        if (p.z > depth) p.z = 0;
      }

      const sorted = [...particles].sort((a, b) => b.z - a.z);

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const p1 = sorted[i];
          const p2 = sorted[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dz = p1.z - p2.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < connectionDistance) {
            const proj1 = project(p1);
            const proj2 = project(p2);
            const opacity =
              (1 - dist / connectionDistance) *
              0.35 *
              proj1.scale *
              proj2.scale;

            ctx.beginPath();
            ctx.moveTo(proj1.x, proj1.y);
            ctx.lineTo(proj2.x, proj2.y);
            ctx.strokeStyle = `rgba(128, 128, 128, ${opacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      for (const p of sorted) {
        const proj = project(p);
        const radius = 2 * proj.scale;
        const opacity = 0.3 + 0.4 * proj.scale;

        ctx.beginPath();
        ctx.arc(proj.x, proj.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(128, 128, 128, ${opacity})`;
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
};

// =============================================================================
// SCROLL BUTTON COMPONENT
// =============================================================================

const ScrollButton = ({
  targetId,
  label,
}: {
  targetId: string;
  label?: string;
}) => {
  const handleScroll = useCallback(() => {
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [targetId]);

  return (
    <button
      type="button"
      onClick={handleScroll}
      className="scroll-down-btn"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "16px 24px",
        marginTop: "clamp(24px, 6vw, 48px)",
        color: "var(--color-text-muted)",
        transition: "all 0.2s ease",
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 12,
            fontFamily: "monospace",
            letterSpacing: "0.5px",
          }}
        >
          {label}
        </span>
      )}
      <IconChevronDown
        size={28}
        style={{
          animation: "bounceDown 2s ease-in-out infinite",
        }}
      />
    </button>
  );
};

// =============================================================================
// MAIN HOME COMPONENT
// =============================================================================

const Home = () => {
  return (
    <div className="terminal-page grid-bg">
      {/* 3D Particle Network Background */}
      <ParticleNetwork />

      {/* Main Content */}
      <div className="flex flex-col relative" style={{ paddingBottom: 24 }}>
        {/* Block 1: Hero */}
        <HeroSection />

        {/* Block 2: Features */}
        <FeaturesSection />

        {/* Block 3: More */}
        <MoreSection />
      </div>

      {/* Status Bar (docs footer) */}
      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>

      {/* Bounce animation for scroll button */}
      <style>{`
				@keyframes bounceDown {
					0%, 20%, 50%, 80%, 100% {
						transform: translateY(0);
					}
					40% {
						transform: translateY(8px);
					}
					60% {
						transform: translateY(4px);
					}
				}
				.scroll-down-btn:hover {
					color: var(--color-accent) !important;
				}
				.scroll-down-btn:hover svg {
					color: var(--color-accent);
				}
			`}</style>
    </div>
  );
};

export default Home;

// =============================================================================
// BLOCK 1: HERO SECTION
// =============================================================================

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
                <IconArrowRight size={18} />
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
                <IconArrowRight size={18} />
              </button>
            </Link>
          </div>
        </div>

        {/* Right: Code Demo - Hidden on mobile */}
        <div className="intro-code hidden-mobile">
          <CodeDemoSection />
        </div>
      </div>

      {/* Scroll to Features */}
      <ScrollButton targetId="features" label="Explore Features" />
    </section>
  );
};

// =============================================================================
// CODE SNIPPET (trusted build-time HTML)
// =============================================================================

const CodeSnippet = ({ html }: { html: string }) => (
  <div
    className="code-demo-content"
    // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized at build time
    dangerouslySetInnerHTML={{ __html: html }}
  />
);

// =============================================================================
// CODE DEMO SECTION
// =============================================================================

const CODE_TABS = [
  { key: "server", label: "Server" },
  { key: "react", label: "React" },
  { key: "db", label: "ORM" },
  { key: "queue", label: "Queue" },
  { key: "command", label: "CLI" },
] as const;

const CodeDemoSection = () => {
  const [activeTab, setActiveTab] = useState(0);
  const activeKey = CODE_TABS[activeTab].key;

  return (
    <div className="w-full" style={{ maxWidth: 750, margin: "0 auto" }}>
      {/* Code Window */}
      <div
        style={{
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            background: "var(--code-header-bg)",
            borderBottom: "1px solid var(--color-border)",
            gap: 12,
          }}
        >
          {/* Traffic lights */}
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#ff5f57",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#febc2e",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#28c840",
              }}
            />
          </div>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 4,
              flex: 1,
              justifyContent: "center",
            }}
          >
            {CODE_TABS.map((tab, index) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(index)}
                className="pill-tab"
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 28,
                  padding: "0 14px",
                  borderRadius: 6,
                  background:
                    activeTab === index
                      ? "var(--color-bg-panel)"
                      : "transparent",
                  border:
                    activeTab === index
                      ? "1px solid var(--color-border)"
                      : "1px solid transparent",
                  color:
                    activeTab === index
                      ? "var(--color-text)"
                      : "var(--color-text-muted)",
                  fontSize: 12,
                  fontFamily: "inherit",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Spacer for symmetry */}
          <div style={{ width: 52 }} />
        </div>

        {/* Code content from snippets */}
        <div
          style={{
            height: 455,
            width: 600,
            overflow: "hidden",
            background: "var(--code-bg)",
          }}
        >
          <CodeSnippet html={snippets[activeKey]} />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// BLOCK 2: FEATURES SECTION
// =============================================================================

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

// =============================================================================
// PACKAGE CHIP
// =============================================================================

const PackageChip = (props: {
  feature: (typeof coreFeatures)[number];
  index: number;
}) => {
  const { feature, index } = props;
  const [hovered, setHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    timeoutRef.current = setTimeout(() => setShowTooltip(true), 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    setShowTooltip(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return (
    <Link
      href={`/docs/${feature.slug}`}
      style={{ textDecoration: "none" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="animate-slide-up package-chip"
        style={{
          animationDelay: `${index * 0.02}s`,
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          fontFamily: "monospace",
          fontSize: 13,
          background: "var(--color-bg)",
          border: `1px solid ${hovered ? "var(--color-border-focus)" : "var(--color-border)"}`,
          borderRadius: 6,
          color: hovered ? "var(--color-text-bright)" : "var(--color-text)",
          cursor: "pointer",
          transition: "all 0.15s ease",
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
        }}
      >
        <feature.icon
          size={16}
          style={{
            color: "var(--color-cyan)",
            flexShrink: 0,
          }}
        />
        <span>{feature.title}</span>
        {"new" in feature && feature.new && (
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: "var(--color-bg)",
              background: "var(--color-accent)",
              padding: "2px 4px",
              borderRadius: 3,
              marginLeft: 2,
            }}
          >
            NEW
          </span>
        )}

        {/* Tooltip */}
        {showTooltip && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "10px 14px",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              zIndex: 100,
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ color: "var(--color-text)" }}>
              {feature.description}
            </span>
            {feature.module && (
              <span
                style={{
                  color: "var(--color-text-muted)",
                  fontSize: 10,
                  fontFamily: "monospace",
                }}
              >
                {feature.module}
              </span>
            )}
            <div
              style={{
                position: "absolute",
                bottom: -5,
                left: "50%",
                transform: "translateX(-50%) rotate(45deg)",
                width: 8,
                height: 8,
                background: "var(--color-bg-elevated)",
                borderRight: "1px solid var(--color-border)",
                borderBottom: "1px solid var(--color-border)",
              }}
            />
          </div>
        )}
      </div>
    </Link>
  );
};

// =============================================================================
// BLOCK 3: MORE SECTION (Install + Links)
// =============================================================================

const MoreSection = () => {
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const command = "npx alepha init";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <section
      id="more"
      className="home-block p-3"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Main Content - Centered */}
      <div
        className="container"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          paddingTop: "clamp(40px, 10vw, 80px)",
          paddingBottom: "clamp(24px, 6vw, 40px)",
        }}
      >
        {/* Section Title */}
        <h2
          style={{
            fontSize: "clamp(24px, 5vw, 32px)",
            fontWeight: 600,
            margin: 0,
            marginBottom: 12,
            color: "var(--color-text-bright)",
            textAlign: "center",
          }}
        >
          Ready to Start?
        </h2>

        {/* Subtitle with asterisk tooltip */}
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: "clamp(14px, 3vw, 16px)",
            margin: 0,
            marginBottom: 32,
            textAlign: "center",
          }}
        >
          One package. Everything included.
          <span
            style={{
              position: "relative",
              display: "inline-block",
              cursor: "help",
            }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <span style={{ color: "var(--color-accent)" }}>*</span>
            {showTooltip && (
              <span
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  padding: "12px 16px",
                  background: "var(--color-bg-panel)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: "inherit",
                  color: "var(--color-text-muted)",
                  width: 280,
                  textAlign: "left",
                  lineHeight: 1.5,
                  zIndex: 100,
                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
                }}
              >
                Some modules like{" "}
                <span style={{ color: "var(--color-cyan)" }}>
                  @alepha/react
                </span>
                , <span style={{ color: "var(--color-cyan)" }}>@alepha/ui</span>
                , and cloud storage providers are separate packages, but
                installed seamlessly by the Alepha CLI.
                <span
                  style={{
                    position: "absolute",
                    bottom: -5,
                    left: "50%",
                    transform: "translateX(-50%) rotate(45deg)",
                    width: 10,
                    height: 10,
                    background: "var(--color-bg-panel)",
                    borderRight: "1px solid var(--color-border)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                />
              </span>
            )}
          </span>
        </p>

        {/* Command Box */}
        <button
          type="button"
          onClick={handleCopy}
          className="install-btn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px 24px",
            background: "var(--color-bg-panel)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            cursor: "pointer",
            transition: "all 0.15s ease",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              color: "var(--color-text-muted)",
              fontFamily: "monospace",
              fontSize: 14,
            }}
          >
            {">_"}
          </span>
          <code
            style={{
              fontSize: 15,
              fontFamily: "monospace",
              color: "var(--color-text)",
            }}
          >
            {command}
          </code>
          <span
            style={{
              color: copied ? "var(--color-accent)" : "var(--color-text-muted)",
              transition: "color 0.15s",
              display: "flex",
              alignItems: "center",
              marginLeft: 8,
            }}
          >
            {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
          </span>
        </button>

        {/* GitHub & npm links */}
        <div
          className="flex gap-6"
          style={{ marginBottom: "clamp(32px, 8vw, 64px)" }}
        >
          <a
            href="https://github.com/feunard/alepha"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link flex items-center gap-2"
            style={{
              color: "var(--color-text-muted)",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            <IconBrandGithub size={18} />
            <span>GitHub</span>
          </a>
          <a
            href="https://www.npmjs.com/package/alepha"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link flex items-center gap-2"
            style={{
              color: "var(--color-text-muted)",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            <IconBrandNpm size={18} />
            <span>npm</span>
          </a>
        </div>

        {/* CTA Card */}
        <div
          className="container"
          style={{
            maxWidth: 700,
          }}
        >
          <div
            className="cta-card"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 24,
              padding: "28px 32px",
              background: "var(--color-bg-panel)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  margin: 0,
                  marginBottom: 6,
                  color: "var(--color-text-bright)",
                }}
              >
                Start Building Today
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--color-text-muted)",
                  margin: 0,
                }}
              >
                Join developers who ship faster with Alepha.
              </p>
            </div>
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
                  padding: "14px 28px",
                  borderRadius: 6,
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  whiteSpace: "nowrap",
                }}
              >
                Read the Docs
                <IconArrowRight size={16} />
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer
        className="container"
        style={{
          paddingTop: 24,
          paddingBottom: 40,
        }}
      >
        <div
          className="home-footer"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
            fontSize: 13,
            color: "var(--color-text-muted)",
          }}
        >
          {/* Left: License + Links */}
          <div className="flex items-center gap-2 flex-wrap">
            <span>MIT License</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <a
              href="https://github.com/feunard/alepha"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              GitHub
            </a>
            <span style={{ opacity: 0.4 }}>·</span>
            <a
              href="https://www.npmjs.com/package/alepha"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              npm
            </a>
          </div>

          {/* Right: Made in France */}
          <div
            className="flex flex-col items-center gap-2"
            style={{ textAlign: "center" }}
          >
            <span>Made in Paris, France</span>
            <span
              style={{
                display: "inline-flex",
                width: 96,
                height: 2,
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <span style={{ flex: 1, background: "#002395" }} />
              <span style={{ flex: 1, background: "#ffffff" }} />
              <span style={{ flex: 1, background: "#ED2939" }} />
            </span>
          </div>
        </div>
      </footer>
    </section>
  );
};
