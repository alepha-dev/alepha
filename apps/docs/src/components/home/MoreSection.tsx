import {
  IconArrowRight,
  IconBrandGithub,
  IconBrandNpm,
  IconCheck,
  IconCopy,
} from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import { useCallback, useState } from "react";

const MoreSection = () => {
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const command = "npx alepha@latest init";

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
                  boxShadow: "var(--shadow-xl)",
                }}
              >
                Some modules like{" "}
                <span style={{ color: "var(--color-cyan)" }}>
                  @alepha/mantine
                </span>{" "}
                and cloud storage providers are separate packages, but installed
                seamlessly by the Alepha CLI.
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px 24px",
            background: "var(--color-bg-panel)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
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
          <button
            type="button"
            onClick={handleCopy}
            aria-label={
              copied ? "Copied to clipboard" : "Copy command to clipboard"
            }
            className="copy-btn"
            style={{
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: copied ? "var(--color-accent)" : "var(--color-text-muted)",
              transition: "color 0.15s",
              display: "flex",
              alignItems: "center",
              marginLeft: 8,
            }}
          >
            {copied ? (
              <IconCheck size={18} aria-hidden="true" />
            ) : (
              <IconCopy size={18} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* GitHub & npm links */}
        <div
          className="flex gap-6"
          style={{ marginBottom: "clamp(32px, 8vw, 64px)" }}
        >
          <a
            href="https://github.com/feunard/alepha"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository (opens in new window)"
            className="footer-link flex items-center gap-2"
            style={{
              color: "var(--color-text-muted)",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            <IconBrandGithub size={18} aria-hidden="true" />
            <span>GitHub</span>
          </a>
          <a
            href="https://www.npmjs.com/package/alepha"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="npm package (opens in new window)"
            className="footer-link flex items-center gap-2"
            style={{
              color: "var(--color-text-muted)",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            <IconBrandNpm size={18} aria-hidden="true" />
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
            <span style={{ opacity: 0.4 }} aria-hidden="true">
              ·
            </span>
            <a
              href="https://github.com/feunard/alepha"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub (opens in new window)"
              className="footer-link"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              GitHub
            </a>
            <span style={{ opacity: 0.4 }} aria-hidden="true">
              ·
            </span>
            <a
              href="https://www.npmjs.com/package/alepha"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="npm (opens in new window)"
              className="footer-link"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              npm
            </a>
            <span style={{ opacity: 0.4 }} aria-hidden="true">
              ·
            </span>
            <a
              href="mailto:contact@alepha.dev"
              className="footer-link"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              Contact
            </a>
          </div>

          {/* Right: Made in France */}
          <div
            className="flex flex-col items-center gap-2"
            style={{ textAlign: "center" }}
          >
            <span>Made in Paris, France</span>
            <span
              aria-label="French flag"
              role="img"
              style={{
                display: "inline-flex",
                width: 96,
                height: 2,
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <span
                style={{ flex: 1, background: "#002395" }}
                aria-hidden="true"
              />
              <span
                style={{ flex: 1, background: "#ffffff" }}
                aria-hidden="true"
              />
              <span
                style={{ flex: 1, background: "#ED2939" }}
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </footer>
    </section>
  );
};

export default MoreSection;
