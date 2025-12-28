import { Link } from "@alepha/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFeatures, coreFeatures } from "../config/features.ts";

// =============================================================================
// ASCII ART
// =============================================================================

const ASCII_LOGO = `
    _    _     _____ ____  _   _    _
   / \\  | |   | ____|  _ \\| | | |  / \\
  / _ \\ | |   |  _| | |_) | |_| | / _ \\
 / ___ \\| |___| |___|  __/|  _  |/ ___ \\
/_/   \\_\\_____|_____|_|   |_| |_/_/   \\_\\
`;

const SMALL_LOGO = `╔═══════════════════════════════════╗
║  ALEPHA FRAMEWORK v0.14.0         ║
║  Type-safe TypeScript Framework   ║
╚═══════════════════════════════════╝`;

// =============================================================================
// BOOT SEQUENCE
// =============================================================================

const bootMessages = [
  { text: "ALEPHA BIOS v1.0.0", delay: 0 },
  { text: "Initializing framework modules...", delay: 200 },
  { text: "Loading @alepha/core.............. OK", delay: 400 },
  { text: "Loading @alepha/server............ OK", delay: 500 },
  { text: "Loading @alepha/react............. OK", delay: 600 },
  { text: "Loading @alepha/orm............... OK", delay: 700 },
  { text: "Type system ready.", delay: 900 },
  { text: "Starting documentation server...", delay: 1100 },
];

const BootSequence = (props: { onComplete: () => void }) => {
  const [visibleLines, setVisibleLines] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    bootMessages.forEach((msg, index) => {
      timers.push(
        setTimeout(() => {
          setVisibleLines(index + 1);
          setProgress(((index + 1) / bootMessages.length) * 100);
        }, msg.delay),
      );
    });

    timers.push(
      setTimeout(() => {
        props.onComplete();
      }, 1800),
    );

    return () => timers.forEach(clearTimeout);
  }, [props.onComplete]);

  return (
    <div className="boot-sequence">
      <div style={{ fontFamily: "monospace", fontSize: 14 }}>
        {bootMessages.slice(0, visibleLines).map((msg, i) => (
          <div
            key={msg.text}
            className="boot-line"
            style={{
              animationDelay: `${i * 0.1}s`,
              color:
                msg.text.includes("OK")
                  ? "var(--term-green)"
                  : "var(--term-text)",
            }}
          >
            {msg.text}
          </div>
        ))}
      </div>
      <div className="boot-progress">
        <div className="boot-progress-bar" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

// =============================================================================
// MATRIX RAIN BACKGROUND
// =============================================================================

const MatrixRain = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789$@#%&";
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(columns).fill(1);

    const draw = () => {
      ctx.fillStyle = "rgba(10, 10, 10, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#22c55e";
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(char, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const interval = setInterval(draw, 50);
    window.addEventListener("resize", resize);

    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="matrix-bg"
      style={{ position: "fixed", top: 0, left: 0, opacity: 0.04 }}
    />
  );
};

// =============================================================================
// TERMINAL PROMPT WITH TYPING
// =============================================================================

const TerminalPrompt = (props: {
  command: string;
  typing?: boolean;
  onTypingComplete?: () => void;
}) => {
  const [displayedText, setDisplayedText] = useState(
    props.typing ? "" : props.command,
  );
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    if (!props.typing) return;

    let index = 0;
    const interval = setInterval(() => {
      if (index < props.command.length) {
        setDisplayedText(props.command.slice(0, index + 1));
        index++;
      } else {
        clearInterval(interval);
        props.onTypingComplete?.();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [props.command, props.typing, props.onTypingComplete]);

  useEffect(() => {
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="prompt" style={{ fontFamily: "monospace" }}>
      <span className="prompt-user">alepha</span>
      <span className="prompt-separator">@</span>
      <span className="prompt-path">docs</span>
      <span className="prompt-symbol">$</span>
      <span style={{ color: "var(--term-text)" }}>{displayedText}</span>
      {showCursor && (
        <span
          style={{
            background: "var(--term-green)",
            width: 8,
            height: 18,
            display: "inline-block",
            marginLeft: 2,
          }}
        />
      )}
    </div>
  );
};

// =============================================================================
// TERMINAL OUTPUT
// =============================================================================

const TerminalOutput = (props: { lines: React.ReactNode[] }) => (
  <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 14 }}>
    {props.lines.map((line, i) => (
      <div key={i} style={{ marginBottom: 4 }}>
        {line}
      </div>
    ))}
  </div>
);

// =============================================================================
// LIVE CLOCK
// =============================================================================

const LiveClock = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span style={{ fontFamily: "monospace" }}>
      {time.toLocaleTimeString("en-US", { hour12: false })}
    </span>
  );
};

// =============================================================================
// FEATURE CARD - TERMINAL STYLE
// =============================================================================

const FeatureTerminalCard = (props: {
  feature: (typeof coreFeatures)[number];
  index: number;
}) => {
  const { feature, index } = props;
  const [hovered, setHovered] = useState(false);

  const command = useMemo(() => {
    const name = feature.title.toLowerCase().replace(/\s+/g, "-");
    return `alepha add ${name}`;
  }, [feature.title]);

  return (
    <Link
      href={`/docs/${feature.slug}`}
      style={{ textDecoration: "none" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="feature-terminal animate-slide-up"
        style={{ animationDelay: `${index * 0.05}s` }}
      >
        <div className="feature-command">{command}</div>
        <div className="flex items-center gap-3">
          <feature.icon
            size={24}
            className="feature-icon"
            style={{
              color: hovered ? "var(--term-green)" : "var(--term-text-dim)",
              transition: "color 0.2s",
            }}
          />
          <div>
            <div className="feature-name">
              {feature.title}
              {"new" in feature && feature.new && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    color: "var(--term-green)",
                    border: "1px solid var(--term-green)",
                    padding: "2px 6px",
                    borderRadius: 3,
                  }}
                >
                  NEW
                </span>
              )}
            </div>
            <div className="feature-desc">{feature.description}</div>
          </div>
        </div>
      </div>
    </Link>
  );
};

// =============================================================================
// MAIN HOME COMPONENT
// =============================================================================

const Home = () => {
  const [booted, setBooted] = useState(false);
  const [heroTyped, setHeroTyped] = useState(false);

  const handleBootComplete = useCallback(() => {
    setBooted(true);
  }, []);

  // Skip boot on subsequent renders (check sessionStorage)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasBooted = sessionStorage.getItem("alepha-booted");
      if (hasBooted) {
        setBooted(true);
        setHeroTyped(true);
      } else {
        sessionStorage.setItem("alepha-booted", "true");
      }
    }
  }, []);

  if (!booted) {
    return <BootSequence onComplete={handleBootComplete} />;
  }

  return (
    <div className="terminal-page grid-bg">
      {/* CRT Overlay Effect */}
      <div className="crt-overlay" />

      {/* Matrix Rain Background */}
      <MatrixRain />

      {/* Main Content */}
      <div className="flex flex-col min-h-screen pb-10 relative">
        {/* Hero Section */}
        <HeroSection heroTyped={heroTyped} setHeroTyped={setHeroTyped} />

        {/* Features Section */}
        <FeaturesSection />

        {/* Install Section */}
        <InstallSection />

        {/* Footer */}
        <FooterSection />
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
};

export default Home;

// =============================================================================
// HERO SECTION
// =============================================================================

const HeroSection = (props: {
  heroTyped: boolean;
  setHeroTyped: (v: boolean) => void;
}) => {
  return (
    <div className="container py-20">
      <div className="flex flex-col items-center gap-10">
        {/* ASCII Logo */}
        <pre
          className="ascii-art ascii-art-large crt-flicker text-center"
        >
          {ASCII_LOGO}
        </pre>

        {/* Terminal Window */}
        <div className="w-full max-w-lg">
          <div className="terminal-window">
            <div className="terminal-titlebar">
              <div className="terminal-buttons">
                <div className="terminal-btn terminal-btn-close" />
                <div className="terminal-btn terminal-btn-minimize" />
                <div className="terminal-btn terminal-btn-maximize" />
              </div>
              <div className="terminal-title">alepha — docs — 80×24</div>
            </div>
            <div className="terminal-body">
              <TerminalPrompt
                command="alepha --version"
                typing={!props.heroTyped}
                onTypingComplete={() => props.setHeroTyped(true)}
              />

              {props.heroTyped && (
                <TerminalOutput
                  lines={[
                    <span key="v" style={{ color: "var(--term-green)" }}>
                      Alepha Framework v0.14.0
                    </span>,
                    "",
                    <span key="d" style={{ color: "var(--term-text-dim)" }}>
                      The convention-driven TypeScript framework for building
                    </span>,
                    <span key="d2" style={{ color: "var(--term-text-dim)" }}>
                      robust, end-to-end type-safe applications.
                    </span>,
                    "",
                    <span key="f">
                      <span style={{ color: "var(--term-cyan)" }}>
                        Features:
                      </span>
                    </span>,
                    <span key="f1">
                      {"  "}• Type-safe HTTP APIs with{" "}
                      <span className="glow-amber">$action</span>
                    </span>,
                    <span key="f2">
                      {"  "}• React SSR/SSG with{" "}
                      <span className="glow-amber">$page</span>
                    </span>,
                    <span key="f3">
                      {"  "}• Database ORM with{" "}
                      <span className="glow-amber">$entity</span>
                    </span>,
                    <span key="f4">
                      {"  "}• Background jobs with{" "}
                      <span className="glow-amber">$queue</span>
                    </span>,
                    <span key="f5">
                      {"  "}• Scheduled tasks with{" "}
                      <span className="glow-amber">$scheduler</span>
                    </span>,
                    "",
                    <span key="run">
                      <span style={{ color: "var(--term-text-dim)" }}>
                        Run{" "}
                      </span>
                      <span className="glow-green">npx alepha init</span>
                      <span style={{ color: "var(--term-text-dim)" }}>
                        {" "}
                        to get started.
                      </span>
                    </span>,
                  ]}
                />
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 flex-wrap justify-center">
          <Link
            href="/docs/guides-introduction"
            style={{ textDecoration: "none" }}
          >
            <button
              type="button"
              style={{
                background: "var(--term-green)",
                color: "var(--term-bg)",
                border: "none",
                padding: "12px 24px",
                borderRadius: 6,
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{">"}</span> Get Started
            </button>
          </Link>
          <a
            href="https://github.com/feunard/alepha"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <button
              type="button"
              style={{
                background: "transparent",
                color: "var(--term-text)",
                border: "1px solid var(--term-border)",
                padding: "12px 24px",
                borderRadius: 6,
                fontFamily: "inherit",
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ color: "var(--term-text-dim)" }}>$</span> git clone
            </button>
          </a>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// FEATURES SECTION
// =============================================================================

const FeaturesSection = () => {
  return (
    <div className="container py-15">
      {/* Core Packages */}
      <div style={{ marginBottom: 80 }}>
        <h2 className="section-header text-xl font-semibold">
          Core Packages
        </h2>
        <p className="text-term-dim mb-6 text-base">
          Low-level primitives and building blocks for type-safe applications.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {coreFeatures.map((feature, index) => (
            <FeatureTerminalCard
              key={feature.title}
              feature={feature}
              index={index}
            />
          ))}
        </div>
      </div>

      {/* Application Modules */}
      <div>
        <h2 className="section-header text-xl font-semibold">
          Application Modules
        </h2>
        <p className="text-term-dim mb-6 text-base">
          Pre-built modules for common application needs.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apiFeatures.map((feature, index) => (
            <FeatureTerminalCard
              key={feature.title}
              feature={feature}
              index={index}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// INSTALL SECTION
// =============================================================================

const InstallSection = () => {
  const [copied, setCopied] = useState(false);
  const command = "npx alepha init";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="container py-15">
      <div className="flex flex-col items-center gap-6">
        <pre className="ascii-art text-center">
          {SMALL_LOGO}
        </pre>

        <div className="terminal-window w-full max-w-sm">
          <div className="terminal-titlebar">
            <div className="terminal-buttons">
              <div className="terminal-btn terminal-btn-close" />
              <div className="terminal-btn terminal-btn-minimize" />
              <div className="terminal-btn terminal-btn-maximize" />
            </div>
            <div className="terminal-title">Quick Start</div>
          </div>
          <div
            className="terminal-body flex justify-between items-center"
          >
            <div className="prompt">
              <span className="prompt-symbol">$</span>
              <span style={{ color: "var(--term-text)" }}>{command}</span>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                background: copied ? "var(--term-green)" : "var(--term-bg)",
                color: copied ? "var(--term-bg)" : "var(--term-text-dim)",
                border: "1px solid var(--term-border)",
                padding: "6px 12px",
                borderRadius: 4,
                fontFamily: "inherit",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="flex gap-6 text-base text-term-dim">
          <a
            href="https://github.com/feunard/alepha"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <span style={{ color: "var(--term-text-dim)" }}>[</span>
            <span style={{ color: "var(--term-cyan)" }}>GitHub</span>
            <span style={{ color: "var(--term-text-dim)" }}>]</span>
          </a>
          <a
            href="https://www.npmjs.com/package/alepha"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <span style={{ color: "var(--term-text-dim)" }}>[</span>
            <span style={{ color: "var(--term-cyan)" }}>npm</span>
            <span style={{ color: "var(--term-text-dim)" }}>]</span>
          </a>
          <Link
            href="/docs/guides-introduction"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <span style={{ color: "var(--term-text-dim)" }}>[</span>
            <span style={{ color: "var(--term-cyan)" }}>Docs</span>
            <span style={{ color: "var(--term-text-dim)" }}>]</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// FOOTER SECTION
// =============================================================================

const FooterSection = () => {
  return (
    <div className="container py-10">
      <div
        className="flex justify-between items-center flex-wrap gap-4 text-sm text-term-dim border-t pt-6"
      >
        <div className="flex gap-4">
          <span>MIT License</span>
          <span>•</span>
          <a
            href="https://github.com/feunard/alepha"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            GitHub
          </a>
          <span>•</span>
          <a
            href="https://www.npmjs.com/package/alepha"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            npm
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span>Made in Paris</span>
          <span
            style={{
              display: "inline-flex",
              width: 36,
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
    </div>
  );
};

// =============================================================================
// STATUS BAR
// =============================================================================

const StatusBar = () => {
  return (
    <div className="status-bar">
      <div className="status-item">
        <span className="status-dot" />
        <span>ready</span>
      </div>
      <div className="status-item">
        <span>main</span>
      </div>
      <div className="status-item">
        <span>TypeScript</span>
      </div>
      <div className="status-item" style={{ marginLeft: "auto" }}>
        <LiveClock />
      </div>
    </div>
  );
};
